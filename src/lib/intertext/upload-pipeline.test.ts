import test from "node:test";
import assert from "node:assert/strict";
import { createChunkPlan } from "./media-chunks.ts";
import { TRANSCRIPTION_CONFIG } from "./media-config.ts";
import { MediaPipelineError, toMediaError } from "./media-errors.ts";
import { fingerprintMedia } from "./media-inspect.ts";
import type { MediaProcessor } from "./media-processor.ts";
import type { Job } from "./types.ts";
import type {
  ChunkCheckpoint,
  ChunkPlan,
  TranscriptionProvider,
  UploadRunOptions,
} from "./media-types.ts";
import { runUploadWithProcessor } from "./upload-pipeline.ts";

async function fixture(duration = 1_500) {
  const file = new File(["ID3media fixture"], "conference.mp3", {
    type: "audio/mpeg",
    lastModified: 123,
  });
  const job: Job = {
    id: "upload-test",
    source: {
      kind: "upload",
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      lastModified: file.lastModified,
      fingerprint: await fingerprintMedia(file),
    },
    title: file.name,
    language: "ko-en",
    requestedLang: "auto",
    sourceType: "transcription",
    provider: "openai",
    providerLabel: "OpenAI",
    segmentCount: 0,
    durationSec: duration,
    createdAt: 1,
    segments: [],
    paragraphs: [],
    availableLanguages: [],
    summaryKind: "ai-conference",
    summary: "",
    upload: {
      status: "idle",
      settings: { language: "ko-en", contentMode: "ai-conference", keywords: ["Blackwell"] },
      chunks: [],
      plan: [],
    },
  };
  const saved: Job[] = [];
  const controller = new AbortController();
  const requests: string[] = [];
  const encodes: string[] = [];
  let closed = false;
  const provider: TranscriptionProvider = {
    async transcribeChunk(chunk) {
      requests.push(chunk.id);
      return {
        text: `Section ${chunk.index + 1}: ${"conference content ".repeat(30)}`,
        timestampQuality: "chunk-estimated",
      };
    },
  };
  const processor: MediaProcessor = {
    async probeDuration() {
      return duration;
    },
    async findSilences() {
      return [];
    },
    async encodeChunk(plan) {
      encodes.push(plan.id);
      return {
        ...plan,
        blob: new Blob(["small audio"]),
        mimeType: "audio/mpeg",
        fileName: "chunk.mp3",
      };
    },
    async close() {
      closed = true;
    },
  };
  const options: UploadRunOptions = {
    file,
    job,
    provider,
    signal: controller.signal,
    onProgress() {},
    async save(value) {
      saved.push(structuredClone(value));
    },
  };
  return {
    file,
    job,
    saved,
    controller,
    requests,
    encodes,
    provider,
    processor,
    options,
    get closed() {
      return closed;
    },
  };
}

test("media -> planning -> sequential mocked transcription -> saved merged job", async () => {
  const data = await fixture(620);
  const result = await runUploadWithProcessor(data.options, async () => data.processor);
  assert.equal(result.upload!.status, "completed");
  assert.equal(data.requests.length, 3);
  assert.equal(result.upload!.chunks.length, 3);
  assert.equal(result.timestampQuality, "chunk-estimated");
  assert.ok(result.paragraphs.length > 0);
  assert.equal(result.summary, "");
  assert.equal(data.closed, true);
  const states = data.saved.map((job) => job.upload!.chunks.length);
  assert.ok(states.includes(1) && states.includes(2) && states.includes(3));
});

test("resume reuses chunks 1-4 and only encodes/transcribes chunk 5", async () => {
  const data = await fixture();
  data.job.upload!.plan = createChunkPlan(data.job.durationSec);
  data.job.upload!.chunks = data.job
    .upload!.plan.slice(0, 4)
    .map((plan) => ({
      ...plan,
      transcript: {
        text: `Completed section ${plan.index + 1}.`,
        timestampQuality: "chunk-estimated",
      },
      completedAt: 1,
      sizeBytes: 1,
    }));
  const result = await runUploadWithProcessor(data.options, async () => data.processor);
  assert.deepEqual(data.requests, [data.job.upload!.plan[4]!.id]);
  assert.deepEqual(data.encodes, data.requests);
  assert.equal(result.upload!.chunks.length, 5);
});

test("fully checkpointed resume rebuilds merge without loading FFmpeg or paying", async () => {
  const data = await fixture(100);
  data.job.upload!.plan = createChunkPlan(100);
  data.job.upload!.chunks = [
    {
      ...data.job.upload!.plan[0]!,
      transcript: { text: "Already completed conference.", timestampQuality: "chunk-estimated" },
      completedAt: 1,
      sizeBytes: 1,
    },
  ];
  const result = await runUploadWithProcessor(data.options, async () => {
    throw new Error("Must not decode completed chunks");
  });
  assert.equal(result.upload!.status, "completed");
  assert.equal(data.requests.length, 0);
});

test("each checkpoint is durable before the next provider request", async () => {
  const data = await fixture(900);
  data.options.provider = {
    async transcribeChunk(chunk, options) {
      assert.equal(data.saved.at(-1)!.upload!.chunks.length, chunk.index);
      assert.ok(
        (options.previousContext?.length ?? 0) <= TRANSCRIPTION_CONFIG.context.previousChunkChars,
      );
      if (chunk.index > 0) assert.ok(options.previousContext?.includes("context"));
      return { text: "context ".repeat(100), timestampQuality: "chunk-estimated" };
    },
  };
  await runUploadWithProcessor(data.options, async () => data.processor);
});

test("oversized generated chunk replans automatically and no unsafe payload reaches provider", async () => {
  const data = await fixture(300);
  const encoded: ChunkPlan[] = [];
  data.processor.encodeChunk = async (plan) => {
    encoded.push(plan);
    return {
      ...plan,
      blob: new Blob([new Uint8Array(plan.coreEnd - plan.coreStart > 151 ? 3_600_000 : 1_800_000)]),
      mimeType: "audio/mpeg",
      fileName: "chunk.mp3",
    };
  };
  data.options.provider = {
    async transcribeChunk(chunk) {
      assert.ok(chunk.blob.size <= TRANSCRIPTION_CONFIG.chunking.hardMaxPayloadBytes);
      data.requests.push(chunk.id);
      return { text: `Speech in ${chunk.id}`, timestampQuality: "chunk-estimated" };
    },
  };
  const result = await runUploadWithProcessor(data.options, async () => data.processor);
  assert.equal(encoded.length, 3);
  assert.equal(data.requests.length, 2);
  assert.equal(result.upload!.plan[0]!.coreEnd, result.upload!.plan[1]!.coreStart);
  assert.equal(result.upload!.plan[0]!.end - result.upload!.plan[1]!.start, 6);
});

test("failed silence optimization uses fixed boundaries and mandatory overlap", async () => {
  const data = await fixture(600);
  data.processor.findSilences = async () => {
    throw new Error("no silence decoder");
  };
  const result = await runUploadWithProcessor(data.options, async () => data.processor);
  assert.equal(result.upload!.plan[0]!.coreEnd, 300);
  assert.equal(result.upload!.plan[0]!.end - result.upload!.plan[1]!.start, 6);
});

test("cancel during chunk3 preserves chunks1-2 and stops every remaining request", async () => {
  const data = await fixture();
  data.options.provider = {
    async transcribeChunk(chunk) {
      data.requests.push(chunk.id);
      if (chunk.index === 2) {
        data.controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }
      return { text: `Successful section ${chunk.index}`, timestampQuality: "chunk-estimated" };
    },
  };
  await assert.rejects(
    runUploadWithProcessor(data.options, async () => data.processor),
    { code: "cancelled" },
  );
  assert.equal(data.requests.length, 3);
  assert.equal(data.saved.at(-1)!.upload!.status, "cancelled");
  assert.equal(data.saved.at(-1)!.upload!.chunks.length, 2);
  assert.equal(data.closed, true);
});

test("wrong reselected file stops before worker or paid transcription", async () => {
  const data = await fixture();
  data.options.file = new File(["different"], data.file.name, {
    type: data.file.type,
    lastModified: 123,
  });
  await assert.rejects(
    runUploadWithProcessor(data.options, async () => {
      throw new Error("should not load");
    }),
    { code: "resume_file_mismatch" },
  );
  assert.equal(data.requests.length, 0);
});

test("authentication failure is not retried and completed checkpoints survive", async () => {
  const data = await fixture(600);
  data.options.provider = {
    async transcribeChunk(chunk) {
      data.requests.push(chunk.id);
      if (chunk.index === 1)
        throw new MediaPipelineError("provider_auth_failed", "API key rejected");
      return { text: "Completed first section", timestampQuality: "chunk-estimated" };
    },
  };
  await assert.rejects(
    runUploadWithProcessor(data.options, async () => data.processor),
    { code: "provider_auth_failed" },
  );
  assert.equal(data.requests.length, 2);
  assert.equal(data.saved.at(-1)!.upload!.chunks.length, 1);
});

test("checkpoint storage failure stops before paying for another section", async () => {
  const data = await fixture(600);
  data.options.save = async (job) => {
    if (job.upload!.chunks.length) throw new DOMException("Quota full", "QuotaExceededError");
  };
  await assert.rejects(
    runUploadWithProcessor(data.options, async () => data.processor),
    { code: "storage_quota" },
  );
  assert.equal(data.requests.length, 1);
});

test("transient failure retries the same section with bounded context", async () => {
  const data = await fixture(100);
  let attempts = 0;
  data.options.provider = {
    async transcribeChunk() {
      attempts++;
      if (attempts === 1)
        throw new MediaPipelineError("network", "Connection interrupted", undefined, true);
      return { text: "Recovered transcript", timestampQuality: "chunk-estimated" };
    },
  };
  const result = await runUploadWithProcessor(data.options, async () => data.processor);
  assert.equal(attempts, 2);
  assert.equal(result.upload!.chunks.length, 1);
});

test("raw checkpoints retain text that overlap merging removes", async () => {
  const data = await fixture(600);
  const plans = createChunkPlan(600);
  const raw: ChunkCheckpoint[] = plans.map((plan) => ({
    ...plan,
    completedAt: 1,
    sizeBytes: 1,
    transcript: { text: "The key point is inference cost.", timestampQuality: "chunk-estimated" },
  }));
  data.job.upload!.plan = plans;
  data.job.upload!.chunks = raw;
  const result = await runUploadWithProcessor(data.options, async () => data.processor);
  assert.equal(result.upload!.chunks[1]!.transcript.text, raw[1]!.transcript.text);
  assert.ok(result.upload!.mergeAudit![0]!.removedTextLength > 0);
});

test("manual edits and speakers survive resume while raw checkpoints stay immutable", async () => {
  const data = await fixture(600);
  data.job.upload!.plan = createChunkPlan(600);
  data.job.upload!.chunks = [
    {
      ...data.job.upload!.plan[0]!,
      completedAt: 1,
      sizeBytes: 1,
      transcript: { text: "Raw provider misspelling.", timestampQuality: "chunk-estimated" },
    },
  ];
  data.job.paragraphEdits = { "0": { text: "Corrected manual wording.", speaker: "Presenter" } };
  const result = await runUploadWithProcessor(data.options, async () => data.processor);
  assert.equal(result.paragraphs[0]!.text, "Corrected manual wording.");
  assert.equal(result.segments[0]!.speaker, "Presenter");
  assert.equal(result.upload!.chunks[0]!.transcript.text, "Raw provider misspelling.");
  assert.ok(result.paragraphs.length > 1);
});

test("empty provider output fails instead of silently dropping real speech", async () => {
  const data = await fixture(100);
  data.options.provider = {
    async transcribeChunk() {
      return { text: " ", timestampQuality: "chunk-estimated" };
    },
  };
  await assert.rejects(
    runUploadWithProcessor(data.options, async () => data.processor),
    { code: "transcription_failed" },
  );
  assert.equal(data.saved.at(-1)!.upload!.chunks.length, 0);
});

test("cancellation interrupts retry backoff without another provider call", async () => {
  const data = await fixture(100);
  let attempts = 0;
  data.options.provider = {
    async transcribeChunk() {
      attempts++;
      throw new MediaPipelineError("network", "Temporary connection failure", undefined, true);
    },
  };
  data.options.onProgress = (progress) => {
    if (progress.message.startsWith("Connection interrupted"))
      queueMicrotask(() => data.controller.abort());
  };
  await assert.rejects(
    runUploadWithProcessor(data.options, async () => data.processor),
    { code: "cancelled" },
  );
  assert.equal(attempts, 1);
  assert.equal(data.saved.at(-1)!.upload!.status, "cancelled");
});

test("provider Error subclasses become plain JSON checkpoint errors", async () => {
  class ProviderError extends Error {
    code = "provider_auth_failed";
    retryable = false;
    details = "Configuration rejected";
  }
  const error = new ProviderError("Provider key rejected");
  assert.equal(Object.getPrototypeOf(toMediaError(error)), Object.prototype);
  const data = await fixture(100);
  data.options.provider = {
    async transcribeChunk() {
      throw error;
    },
  };
  data.options.save = async (job) => {
    if (job.upload?.error) assert.equal(Object.getPrototypeOf(job.upload.error), Object.prototype);
    data.saved.push(structuredClone(job));
  };
  await assert.rejects(
    runUploadWithProcessor(data.options, async () => data.processor),
    { code: "provider_auth_failed" },
  );
  assert.equal(data.saved.at(-1)!.upload!.status, "failed");
  assert.equal(data.saved.at(-1)!.upload!.error!.code, "provider_auth_failed");
});
