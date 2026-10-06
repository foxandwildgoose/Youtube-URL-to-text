import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanSlides } from "./scan.ts";
import { imageFeature, type Feature } from "./detection.ts";
import type { FrameSource } from "./types.ts";
import { testJob, testState } from "./test-fixtures.ts";
function feature(seed: number): Feature {
  const data = new Uint8ClampedArray(192 * 108 * 4);
  let rng = seed + 1;
  for (let i = 0; i < 192 * 108; i++) {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    const n = seed < 0 ? 0 : (rng >>> 0) % 230;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = n;
    data[i * 4 + 3] = 255;
  }
  return imageFeature(data, 192, 108);
}
function fakeSource(sequence: (time: number) => number, duration = 6) {
  const source: FrameSource = {
    duration,
    width: 640,
    height: 360,
    rotation: 0,
    decoder: "native",
    capture: async (time) => ({
      canvas: { width: 192, height: 108, time } as unknown as HTMLCanvasElement,
      timing: {
        requested: time,
        actual: time,
        method: "video-frame-callback",
        uncertaintySec: 0.02,
      },
    }),
    close: async () => {},
  };
  return {
    source,
    feature: (canvas: HTMLCanvasElement) =>
      feature(sequence((canvas as unknown as { time: number }).time)),
    evidence: async (_source: FrameSource, time: number, _roi: unknown, id: string) => ({
      ...testState(id).evidence[0]!,
      id,
      time: {
        requested: time,
        actual: time,
        method: "video-frame-callback" as const,
        uncertaintySec: 0.02,
      },
    }),
  };
}
describe("streaming chronological states", () => {
  it("retains three A→B→A appearances, first/last intervals and evidence", async () => {
    const fake = fakeSource((t) => (t < 2 ? 1 : t < 4 ? 2 : 1));
    const job = testJob([]);
    job.slides!.scanCursor = 0;
    job.slides!.scanComplete = false;
    const result = await scanSlides({
      job,
      ...fake,
      signal: new AbortController().signal,
      save: async () => {},
      saveAsset: async () => {},
      onProgress: () => {},
    });
    assert.equal(result.slides!.states.length, 3);
    assert.equal(result.slides!.states[0]!.start, 0);
    assert.equal(result.slides!.states[2]!.end, 6);
    assert(
      result.slides!.states[1]!.startBoundary.high - result.slides!.states[1]!.startBoundary.low <=
        0.25,
    );
  });
  it("keeps a one-sample disappearing state as uncertain evidence", async () => {
    const fake = fakeSource((t) => (t < 2 || t >= 2.5 ? 1 : 2));
    const job = testJob([]);
    job.slides!.scanCursor = 0;
    const result = await scanSlides({
      job,
      ...fake,
      signal: new AbortController().signal,
      save: async () => {},
      saveAsset: async () => {},
      onProgress: () => {},
    });
    assert.equal(result.slides!.states.length, 3);
    assert(result.slides!.states[1]!.flags.includes("incomplete"));
    assert(result.slides!.audit.some((a) => a.kind === "transition"));
  });
  it("does not extend final visibility across a black gap", async () => {
    const fake = fakeSource((t) => (t < 4 ? 1 : -1));
    const job = testJob([]);
    job.slides!.scanCursor = 0;
    const result = await scanSlides({
      job,
      ...fake,
      signal: new AbortController().signal,
      save: async () => {},
      saveAsset: async () => {},
      onProgress: () => {},
    });
    assert(result.slides!.states[0]!.end < 6);
    assert(result.slides!.audit.some((a) => a.kind === "black" && a.end === 6));
  });
  it("pauses at candidate safeguards without claiming the remainder complete", async () => {
    const fake = fakeSource((t) => Math.floor(t));
    const job = testJob([]);
    job.slides!.scanCursor = 0;
    job.slides!.settings.maxCandidates = 2;
    const result = await scanSlides({
      job,
      ...fake,
      signal: new AbortController().signal,
      save: async () => {},
      saveAsset: async () => {},
      onProgress: () => {},
    });
    assert.equal(result.slides!.status, "paused");
    assert(!result.slides!.scanComplete);
    assert(result.slides!.scanCursor < 6);
    assert.equal(result.slides!.states.length, 2);
  });
  it("persists cancellation checkpoints and disposes sampled canvases", async () => {
    const fake = fakeSource(() => 1);
    const job = testJob([]);
    job.slides!.scanCursor = 0;
    const controller = new AbortController();
    let saved = job;
    await assert.rejects(
      scanSlides({
        job,
        ...fake,
        signal: controller.signal,
        save: async (next) => {
          saved = structuredClone(next);
          if (next.slides!.states.length) controller.abort();
        },
        saveAsset: async () => {},
        onProgress: () => {},
      }),
    );
    assert.equal(saved.slides!.status, "cancelled");
    assert(saved.slides!.states.length);
  });
});
