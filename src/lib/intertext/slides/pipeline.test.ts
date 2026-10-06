import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSlides } from "./pipeline.ts";
import type { Job } from "../types.ts";
import { TEST_PROFILE, TEST_TEXT, testJob, testState, TEST_ASSETS } from "./test-fixtures.ts";
import type { ProviderResult } from "./types.ts";
import { stateBlocks } from "./export.ts";
function harness(
  job = testJob(),
  result: ProviderResult = {
    ok: true,
    model: TEST_PROFILE.model,
    extraction: TEST_TEXT,
    usage: {
      inputTokens: 3000,
      outputTokens: 1000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 800,
    },
  },
) {
  let calls = 0;
  const saved: Job[] = [];
  const options = {
    job,
    signal: new AbortController().signal,
    profiles: [TEST_PROFILE],
    save: async (j: Job) => {
      saved.push(structuredClone(j));
    },
    loadAsset: async (id: string) => TEST_ASSETS.get(id),
    provider: {
      extract: async () => {
        calls++;
        return result;
      },
    },
  };
  return { options, saved, calls: () => calls };
}
describe("checkpointed visual operations", () => {
  it("rejects an asset with a mismatched exact image hash before a paid call", async () => {
    const h = harness();
    await assert.rejects(
      extractSlides({
        ...h.options,
        loadAsset: async () => new Blob(["wrong pixels"], { type: "image/png" }),
      }),
      /saved hash/,
    );
    assert.equal(h.calls(), 0);
  });
  it("pauses a hypothetical $5.80 dense remaining plan under the default $5 budget", async () => {
    const states = Array.from({ length: 160 }, (_, i) =>
      testState(`dense-${i}`, i.toString(16).padStart(64, "0")),
    );
    for (const state of states) {
      const crop = state.evidence[0]!.crops[0]!;
      Object.assign(crop, { width: 2000, height: 550, fullWidth: 2000, fullHeight: 550 });
    }
    const h = harness(testJob(states));
    h.options.job.slides!.settings.inputTokensPerMegapixel = 5000;
    h.options.job.slides!.settings.outputAllowance = 1500;
    const job = await extractSlides(h.options);
    assert.equal(h.calls(), 0);
    assert.equal(job.slides!.status, "paused");
    assert.match(job.slides!.error!, /selected remaining plan/);
    assert.equal(job.slides!.states.length, 160);
  });
  it("keeps the accepted extraction and edited blocks when a retry drops/reorders text", async () => {
    const h = harness();
    const original = await extractSlides(h.options);
    const state = original.slides!.states[0]!;
    const crop = state.evidence[0]!.crops[0]!.id;
    state.edits[`${crop}:0`] = "manual title";
    const job = await extractSlides({
      ...h.options,
      job: original,
      retryCropIds: new Set([crop]),
      provider: {
        extract: async () => ({
          ok: true,
          model: TEST_PROFILE.model,
          extraction: { status: "textless", blocks: [], flags: [], unreadable: [] },
        }),
      },
    });
    assert.equal(job.slides!.states[0]!.attempts.length, 2);
    assert.equal(stateBlocks(job.slides!.states[0]!)[0]!.edited, "manual title");
    assert.equal(stateBlocks(job.slides!.states[0]!).length, 3);
  });
  it("uses only a bounded retry for explicitly rejected transient rate limits", async () => {
    const h = harness();
    let calls = 0;
    const job = await extractSlides({
      ...h.options,
      provider: {
        extract: async () => {
          calls++;
          return calls === 1
            ? {
                ok: false,
                error: {
                  code: "rate_limited",
                  message: "rate",
                  retryable: true,
                  retryAfterSec: 0.001,
                  billing: "none",
                },
              }
            : { ok: true, model: TEST_PROFILE.model, extraction: TEST_TEXT };
        },
      },
    });
    assert.equal(calls, 2);
    assert.equal(job.slides!.states[0]!.attempts.length, 2);
    assert.equal(job.slides!.states[0]!.status, "completed");
  });
  it("saves unknown billing on accepted cancellation and preserves completed work", async () => {
    const h = harness();
    const controller = new AbortController();
    const job = await extractSlides({
      ...h.options,
      signal: controller.signal,
      provider: {
        extract: async () => {
          controller.abort();
          return {
            ok: false,
            error: { code: "transport_unknown", message: "lost after cancel", billing: "unknown" },
          };
        },
      },
    });
    assert.equal(job.slides!.status, "cancelled");
    assert.equal(job.slides!.states[0]!.attempts[0]!.outcome, "unknown-billing");
  });
  it("records intent and saves immutable output before the next paid call", async () => {
    const h = harness(testJob([testState(), testState("s2", "b".repeat(64))]));
    await extractSlides(h.options);
    assert.equal(h.calls(), 2);
    assert(
      h.saved.some((j) => j.slides!.states[0]!.attempts[0]?.error?.code === "dispatch_pending"),
    );
    assert(
      h.saved.some(
        (j) =>
          j.slides!.states[0]!.attempts[0]?.outcome === "completed" &&
          j.slides!.states[1]!.attempts.length === 0,
      ),
    );
    assert.equal(h.saved.at(-1)!.slides!.status, "completed");
  });
  it("reuses exact content while retaining three appearances and preserving edits", async () => {
    const h = harness(testJob([testState(), testState("B", "b".repeat(64)), testState("A-again")]));
    let job = await extractSlides(h.options);
    assert.equal(h.calls(), 2);
    assert.equal(job.slides!.states.length, 3);
    assert(job.slides!.states[2]!.attempts[0]!.reusedFrom);
    const key = `${job.slides!.states[0]!.evidence[0]!.crops[0]!.id}:0`;
    job.slides!.states[0]!.edits[key] = "manual correction";
    job = await extractSlides({
      ...h.options,
      job,
      retryCropIds: new Set([job.slides!.states[0]!.evidence[0]!.crops[0]!.id]),
    });
    assert.equal(job.slides!.states[0]!.edits[key], "manual correction");
    assert.equal(job.slides!.states[0]!.attempts.length, 2);
  });
  it("pauses before exceeding a budget instead of dropping states", async () => {
    const h = harness();
    h.options.job.slides!.settings.budgetUsd = 0.01;
    const job = await extractSlides(h.options);
    assert.equal(h.calls(), 0);
    assert.equal(job.slides!.status, "paused");
    assert.equal(job.slides!.states.length, 1);
  });
  it("requires selection approval and leaves unselected states unfinished", async () => {
    const h = harness();
    h.options.job.slides!.approvedStateIds = [];
    assert.equal((await extractSlides(h.options)).slides!.status, "paused");
    assert.equal(h.calls(), 0);
    const h2 = harness(testJob([testState(), testState("s2")]));
    h2.options.job.slides!.states[1]!.selected = false;
    assert.equal((await extractSlides(h2.options)).slides!.status, "review");
  });
  it("stops on checkpoint quota failure before another paid request", async () => {
    const h = harness(testJob([testState(), testState("s2", "b".repeat(64))]));
    await assert.rejects(
      extractSlides({
        ...h.options,
        save: async (j) => {
          if (j.slides!.states[0]!.attempts.some((a) => a.outcome === "completed"))
            throw new Error("QuotaExceededError");
        },
      }),
    );
    assert.equal(h.calls(), 1);
  });
  it("does not retry auth/permanent failures or unknown billing automatically", async () => {
    for (const error of [
      { code: "access_denied", message: "bad", billing: "none" as const },
      { code: "transport_unknown", message: "unknown", billing: "unknown" as const },
    ]) {
      const h = harness(testJob(), { ok: false, error });
      const job = await extractSlides(h.options);
      assert.equal(h.calls(), 1);
      assert.equal(job.slides!.status, "paused");
      if (error.billing === "unknown") {
        await extractSlides({ ...h.options, job });
        assert.equal(h.calls(), 1);
        await extractSlides({ ...h.options, job, approveUnknown: true });
        assert.equal(h.calls(), 2);
      }
    }
  });
  it("retains incomplete partial evidence/usage rather than marking completed", async () => {
    const h = harness(testJob(), {
      ok: false,
      model: TEST_PROFILE.model,
      error: { code: "incomplete", message: "output limit", billing: "known" },
      partialText: "partial source",
      usage: {
        inputTokens: 3000,
        outputTokens: 1000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 800,
      },
    });
    const job = await extractSlides(h.options);
    assert.equal(job.slides!.states[0]!.status, "incomplete");
    assert.equal(job.slides!.states[0]!.attempts[0]!.costUsd, 0.016);
    assert.equal(job.slides!.states[0]!.attempts[0]!.partialText, "partial source");
  });
  it("resumes completed states without repeat paid requests", async () => {
    const h = harness();
    const job = await extractSlides(h.options);
    await extractSlides({ ...h.options, job });
    assert.equal(h.calls(), 1);
  });
  it("accepts empty textless extraction as completed, independently of audio", async () => {
    const h = harness(testJob(), {
      ok: true,
      model: TEST_PROFILE.model,
      extraction: { status: "textless", blocks: [], flags: [], unreadable: [] },
    });
    const job = await extractSlides(h.options);
    assert.equal(job.slides!.states[0]!.status, "completed");
    assert.equal(job.paragraphs.length, 0);
    assert.equal(job.summary, "");
    assert.equal(job.upload, undefined);
  });
});
