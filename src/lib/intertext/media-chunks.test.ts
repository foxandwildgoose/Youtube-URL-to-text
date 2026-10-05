import test from "node:test";
import assert from "node:assert/strict";
import {
  createChunkPlan,
  parseSilenceLog,
  selectBoundary,
  splitOversizedChunk,
} from "./media-chunks.ts";
import { TRANSCRIPTION_CONFIG } from "./media-config.ts";
import { fingerprintMedia, validateMedia } from "./media-inspect.ts";

test("silence near 300 seconds chooses its midpoint and applies both buffers", () => {
  const plan = createChunkPlan(620, [{ start: 297.4, end: 298.2 }]);
  assert.equal(plan.length, 3);
  assert.ok(Math.abs(plan[0]!.coreEnd - 297.8) < 0.00001);
  assert.equal(plan[0]!.start, 0);
  assert.ok(Math.abs(plan[0]!.end - 300.8) < 0.00001);
  assert.ok(Math.abs(plan[1]!.start - 294.8) < 0.00001);
  assert.equal(plan[2]!.end, 620);
  assert.equal(plan[0]!.end - plan[1]!.start, 6);
});

test("missing, short or far silence keeps fixed boundary with overlap", () => {
  assert.equal(
    selectBoundary(
      300,
      [
        { start: 297.8, end: 298.1 },
        { start: 270, end: 272 },
      ],
      620,
    ),
    300,
  );
  const plan = createChunkPlan(601);
  assert.equal(plan[0]!.coreEnd, 300);
  assert.equal(plan[1]!.start, 297);
  assert.equal(plan[0]!.end, 303);
  assert.equal(plan[2]!.start, 597);
  assert.equal(plan[2]!.end, 601);
});

test("first/last short files and invalid durations are clamped", () => {
  assert.deepEqual(createChunkPlan(0), []);
  assert.deepEqual(createChunkPlan(Infinity), []);
  assert.deepEqual(
    createChunkPlan(10).map(({ start, end }) => [start, end]),
    [[0, 10]],
  );
});

test("oversized payload splits automatically without gaps and retains overlap", () => {
  const original = createChunkPlan(600)[0]!;
  const replacement = splitOversizedChunk(original, 7_000_000, 600);
  assert.equal(replacement.length, 3);
  assert.equal(replacement[0]!.coreStart, original.coreStart);
  assert.equal(replacement.at(-1)!.coreEnd, original.coreEnd);
  for (let i = 1; i < replacement.length; i++) {
    assert.equal(replacement[i - 1]!.coreEnd, replacement[i]!.coreStart);
    assert.equal(replacement[i - 1]!.end - replacement[i]!.start, 6);
  }
  assert.deepEqual(splitOversizedChunk(createChunkPlan(5)[0]!, 4_000_000, 5), []);
});

test("silencedetect window offsets and trailing quiet area are preserved", () => {
  assert.deepEqual(
    parseSilenceLog(
      ["silence_start: 12.3", "silence_end: 13.1 | silence_duration: 0.8", "silence_start: 29"],
      285,
      30,
    ),
    [
      { start: 297.3, end: 298.1 },
      { start: 314, end: 315 },
    ],
  );
});

test("media selection validates both extension and MIME", () => {
  assert.doesNotThrow(() =>
    validateMedia(new File(["source"], "gopro.mp4", { type: "video/mp4" })),
  );
  assert.doesNotThrow(() => validateMedia(new File(["source"], "recording.mp3", { type: "" })));
  assert.throws(() => validateMedia(new File(["source"], "renamed.mp4", { type: "text/plain" })), {
    code: "unsupported_file",
  });
  assert.throws(() => validateMedia(new File(["source"], "source.exe", { type: "video/mp4" })), {
    code: "unsupported_file",
  });
  assert.throws(() => validateMedia(new File([], "empty.mp3", { type: "audio/mpeg" })), {
    code: "unsupported_file",
  });
});

test("fingerprint reads only small samples, verifies metadata, and is repeatable", async () => {
  const file = new File([new Uint8Array(1_000_000)], "gopro.mp4", {
    type: "video/mp4",
    lastModified: 123,
  });
  const samples: number[] = [];
  const slice = file.slice.bind(file);
  file.slice = (start, end, contentType) => {
    const result = slice(start, end, contentType);
    samples.push(result.size);
    return result;
  };
  const first = await fingerprintMedia(file);
  assert.equal(first.length, 64);
  assert.equal(await fingerprintMedia(file), first);
  assert.ok(samples.every((size) => size <= TRANSCRIPTION_CONFIG.limits.fingerprintSampleBytes));
  assert.notEqual(
    await fingerprintMedia(
      new File([new Uint8Array(1_000_000)], "different.mp4", { lastModified: 123 }),
    ),
    first,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fingerprintMedia(file, controller.signal), { code: "cancelled" });
});
