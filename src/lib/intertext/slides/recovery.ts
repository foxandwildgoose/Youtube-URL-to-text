import type { Job } from "../types.ts";
import { checkAbort, SlideFailure } from "./config.ts";
import { captureEvidence, type AssetWriter } from "./images.ts";
import type { FrameSource } from "./types.ts";
/** Recover missing images without changing content keys, accepted text or corrections. */
export async function regenerateEvidence(options: {
  job: Job;
  source: FrameSource;
  signal: AbortSignal;
  saveAsset: AssetWriter;
  getAsset: (id: string) => Promise<Blob | undefined>;
  save: (job: Job) => Promise<void>;
  capture?: typeof captureEvidence;
  onProgress?: (done: number, total: number) => void;
}): Promise<Job> {
  const job = structuredClone(options.job);
  if (!job.slides) throw new SlideFailure("This is not a visual job.");
  const evidence = job.slides.states.flatMap((s) => s.evidence);
  let done = 0;
  for (const saved of evidence) {
    checkAbort(options.signal);
    const missing =
      !(await options.getAsset(saved.assetId)) ||
      (await Promise.all(saved.crops.map((c) => options.getAsset(c.assetId)))).some(
        (blob) => !blob,
      );
    if (missing) {
      const generated = await (options.capture ?? captureEvidence)(
        options.source,
        saved.time.actual,
        saved.roi,
        crypto.randomUUID(),
        options.saveAsset,
        options.signal,
      );
      const replacements = saved.crops.map((old) => ({
        old,
        fresh: generated.crops.find(
          (c) =>
            c.x === old.x &&
            c.y === old.y &&
            c.width === old.width &&
            c.height === old.height &&
            c.fullWidth === old.fullWidth &&
            c.fullHeight === old.fullHeight &&
            c.hash === old.hash,
        ),
      }));
      if (replacements.some((pair) => !pair.fresh) || generated.crops.length !== saved.crops.length)
        throw new SlideFailure(
          "Regenerated pixels/crops differ from the saved evidence. Earlier text and edits are kept. Capture a new alternative and review it deliberately; old paid results were not reused for different content.",
          "evidence_mismatch",
        );
      saved.assetId = generated.assetId;
      saved.crops = replacements.map(({ old, fresh }) => ({
        ...old,
        assetId: fresh!.assetId,
        sizeBytes: fresh!.sizeBytes,
      }));
      await options.save(job);
    }
    options.onProgress?.(++done, evidence.length);
  }
  return job;
}
