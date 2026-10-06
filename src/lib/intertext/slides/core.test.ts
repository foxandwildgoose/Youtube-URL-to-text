import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareFeatures, imageFeature, StateDetector, type Feature } from "./detection.ts";
import { perspectiveMap, regionAt, validCorners } from "./roi.ts";
import { validateExtraction, validateSlideData } from "./schema.ts";
import { exportSlides, formatSlideTime } from "./export.ts";
import { operationKey } from "./client.ts";
import { TEST_PROFILE, TEST_TEXT, testJob, testState } from "./test-fixtures.ts";
function feature(seed: number): Feature {
  const rgba = new Uint8ClampedArray(192 * 108 * 4);
  let rng = seed + 1;
  for (let y = 0; y < 108; y++)
    for (let x = 0; x < 192; x++) {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      const n = (rng >>> 0) % 211;
      const i = (y * 192 + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = n;
      rgba[i + 3] = 255;
    }
  return imageFeature(rgba, 192, 108);
}
describe("visual evidence invariants", () => {
  it("retains A→B→A and disappearing animation states", () => {
    const d = new StateDetector(),
      a = feature(1),
      b = feature(2);
    assert.equal(d.push(a, 0).kind, "candidate");
    assert.equal(d.push(a, 0.5).kind, "stable");
    assert.equal(d.push(b, 1).kind, "candidate");
    assert.equal(d.push(b, 1.5).kind, "stable");
    assert.equal(d.push(a, 2).kind, "candidate");
    assert.equal(d.push(a, 2.5).kind, "stable");
  });
  it("detects a small number/cell region change under an unchanged title", () => {
    const a = feature(1),
      b = { ...a, pixels: a.pixels.slice() };
    for (let y = 50; y < 55; y++) for (let x = 100; x < 105; x++) b.pixels[y * 192 + x] = 255;
    assert(compareFeatures(a, b).changed);
  });
  it("compensates exposure flicker without erasing local changes", () => {
    const a = feature(1),
      b = { ...a, pixels: a.pixels.map((n) => n + 10), mean: a.mean + 10 };
    assert.equal(compareFeatures(a, b).changed, false);
  });
  it("flags translation/shake instead of assuming another text slide", () => {
    const a = feature(1),
      b = { ...a, pixels: a.pixels.slice() };
    for (let y = 0; y < 108; y++)
      for (let x = 1; x < 192; x++) b.pixels[y * 192 + x] = a.pixels[y * 192 + x - 1]!;
    assert(compareFeatures(a, b).motion);
  });
  it("classifies black/unobservable evidence and resets stability", () => {
    const d = new StateDetector();
    const empty = imageFeature(new Uint8ClampedArray(192 * 108 * 4), 192, 108);
    assert.equal(d.push(empty, 0).kind, "black");
    const a = feature(1);
    assert.equal(d.push(a, 1).kind, "candidate");
  });
  it("requires a valid perspective quad and preserves original corners", () => {
    const corners = testState().evidence[0]!.roi.corners;
    assert(validCorners(corners));
    const map = perspectiveMap(corners);
    assert.deepEqual(map(0, 0), { x: 0, y: 0 });
    assert.deepEqual(map(1, 1), { x: 1, y: 1 });
    assert.equal(validCorners([corners[0], corners[2], corners[1], corners[3]]), false);
    assert.equal(
      regionAt(
        [
          { time: 0, corners, method: "projective-mesh-v1" },
          { time: 4, corners, method: "projective-mesh-v1" },
        ],
        5,
      ).time,
      4,
    );
  });
  it("preserves Unicode/code/empty table cells and valid textless extraction", () => {
    assert.deepEqual(validateExtraction(TEST_TEXT), TEST_TEXT);
    assert.equal(
      validateExtraction({ status: "textless", blocks: [], flags: [], unreadable: [] }).blocks
        .length,
      0,
    );
    assert.throws(() => validateExtraction({ ...TEST_TEXT, status: "textless" }));
    assert.throws(() => validateExtraction({ ...TEST_TEXT, timestamp: 123 }));
  });
  it("strictly validates visual checkpoints and rejects binary job fields", () => {
    assert.deepEqual(validateSlideData(testJob().slides), testJob().slides);
    assert.throws(() =>
      validateSlideData({ ...testJob().slides, base64: "data:image/png;base64,..." }),
    );
  });
  it("keys reuse by exact image and transform/provider contract, never title/perceptual hash", () => {
    const ev = testState().evidence[0]!,
      crop = ev.crops[0]!,
      key = operationKey(crop, ev.roi, TEST_PROFILE);
    assert.notEqual(key, operationKey({ ...crop, hash: "b".repeat(64) }, ev.roi, TEST_PROFILE));
    assert.notEqual(key, operationKey(crop, ev.roi, { ...TEST_PROFILE, detail: "high" }));
    assert.notEqual(
      key,
      operationKey(
        crop,
        {
          ...ev.roi,
          corners: [{ x: 0.01, y: 0 }, ...ev.roi.corners.slice(1)] as typeof ev.roi.corners,
        },
        TEST_PROFILE,
      ),
    );
  });
  it("exports literal text, separate edits, inert HTML and code whitespace", () => {
    const job = testJob(),
      state = job.slides!.states[0]!;
    state.attempts.push({
      id: "a",
      operationKey: "k",
      cropId: state.evidence[0]!.crops[0]!.id,
      model: TEST_PROFILE.model,
      profile: "standard",
      promptVersion: "1",
      schemaVersion: "1",
      detail: "auto",
      outcome: "completed",
      at: 1,
      extraction: TEST_TEXT,
    });
    state.edits[`${state.evidence[0]!.crops[0]!.id}:0`] = "<script>evil</script> 보안";
    const txt = exportSlides(job, "txt"),
      md = exportSlides(job, "md");
    assert(txt.includes('    print("HBM4")'));
    assert(txt.includes("Rubin\t"));
    assert(md.includes("\\<script\\>"));
    assert(md.includes("| Rubin |  |"));
    assert.equal(TEST_TEXT.blocks[0]!.text, "AI 보안 / NVIDIA");
    assert(!exportSlides(job, "json").includes("OPENAI_API_KEY"));
    assert.equal(formatSlideTime(72.25), "00:01:12.250");
    state.acceptedAttemptIds = { [state.evidence[0]!.crops[0]!.id]: "a" };
    state.attempts.push({
      ...state.attempts[0]!,
      id: "new-textless",
      extraction: { status: "textless", blocks: [], flags: [], unreadable: [] },
    });
    assert(!exportSlides(job, "txt").includes("[Audit: textless source region]"));
    assert(exportSlides(job, "txt").includes("HBM4"));
  });
});
