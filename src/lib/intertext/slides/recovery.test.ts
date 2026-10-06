import assert from "node:assert/strict";
import { it } from "node:test";
import { regenerateEvidence } from "./recovery.ts";
import { testJob } from "./test-fixtures.ts";
import type { FrameSource } from "./types.ts";
const source: FrameSource = {
  duration: 10,
  width: 640,
  height: 360,
  rotation: 0,
  decoder: "native",
  capture: async () => {
    throw new Error("injected capture required");
  },
  close: async () => {},
};
it("recovers image references while preserving content hash, checkpoints and edits", async () => {
  const job = testJob(),
    ev = job.slides!.states[0]!.evidence[0]!;
  job.slides!.states[0]!.edits["manual"] = "correction";
  let saves = 0;
  const recovered = await regenerateEvidence({
    job,
    source,
    signal: new AbortController().signal,
    getAsset: async () => undefined,
    saveAsset: async () => {},
    save: async () => {
      saves++;
    },
    capture: async () => ({
      ...structuredClone(ev),
      assetId: "new-thumbnail",
      crops: ev.crops.map((c) => ({ ...c, assetId: "new-image" })),
    }),
  });
  assert.equal(recovered.slides!.states[0]!.evidence[0]!.crops[0]!.hash, ev.crops[0]!.hash);
  assert.equal(recovered.slides!.states[0]!.evidence[0]!.crops[0]!.id, ev.crops[0]!.id);
  assert.equal(recovered.slides!.states[0]!.edits.manual, "correction");
  assert.equal(saves, 1);
});
it("rejects different regenerated pixels instead of reusing saved paid text", async () => {
  const job = testJob(),
    ev = job.slides!.states[0]!.evidence[0]!;
  await assert.rejects(
    regenerateEvidence({
      job,
      source,
      signal: new AbortController().signal,
      getAsset: async () => undefined,
      saveAsset: async () => {},
      save: async () => {
        throw new Error("must not commit mismatch");
      },
      capture: async () => ({
        ...structuredClone(ev),
        crops: ev.crops.map((c) => ({ ...c, hash: "f".repeat(64) })),
      }),
    }),
    /differ/,
  );
});
