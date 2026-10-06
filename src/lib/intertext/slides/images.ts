import {
  checkAbort,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  SlideFailure,
} from "./config.ts";
import type { Crop, Evidence, FrameSource, Region } from "./types.ts";
import { canvasFeature } from "./detection.ts";
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new SlideFailure("The browser could not encode an evidence image.")),
      "image/png",
    ),
  );
}
export async function imageHash(blob: Blob): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export type AssetWriter = (id: string, blob: Blob) => Promise<void>;
/** Lossless, overlapping recursive crops. Never shrink dense text to meet a transport ceiling. */
export async function cropCanvas(
  canvas: HTMLCanvasElement,
  prefix: string,
  save: AssetWriter,
  signal?: AbortSignal,
): Promise<Crop[]> {
  const crops: Crop[] = [];
  async function visit(x: number, y: number, width: number, height: number, depth: number) {
    checkAbort(signal);
    if (depth > 12 || crops.length >= 200)
      throw new SlideFailure(
        "This evidence needs too many readable crops. Correct the ROI or review a smaller area; no regions were silently dropped.",
        "crop_explosion",
      );
    const part = document.createElement("canvas");
    part.width = width;
    part.height = height;
    part.getContext("2d")!.drawImage(canvas, x, y, width, height, 0, 0, width, height);
    const blob = await canvasPng(part);
    part.width = 0;
    part.height = 0;
    if (
      blob.size <= MAX_IMAGE_BYTES &&
      width <= MAX_IMAGE_DIMENSION &&
      height <= MAX_IMAGE_DIMENSION &&
      width * height <= MAX_IMAGE_PIXELS
    ) {
      const id = `${prefix}-crop-${crops.length}`;
      await save(id, blob);
      crops.push({
        id,
        x,
        y,
        width,
        height,
        fullWidth: canvas.width,
        fullHeight: canvas.height,
        overlap: 32,
        assetId: id,
        hash: await imageHash(blob),
        sizeBytes: blob.size,
      });
      return;
    }
    if (width < 96 && height < 96)
      throw new SlideFailure("A readable image cannot fit the safe request size.");
    if (width >= height) {
      const cut = Math.floor(width / 2),
        overlap = Math.min(32, Math.floor(width / 8));
      await visit(x, y, cut + overlap, height, depth + 1);
      await visit(x + cut - overlap, y, width - cut + overlap, height, depth + 1);
    } else {
      const cut = Math.floor(height / 2),
        overlap = Math.min(32, Math.floor(height / 8));
      await visit(x, y, width, cut + overlap, depth + 1);
      await visit(x, y + cut - overlap, width, height - cut + overlap, depth + 1);
    }
  }
  await visit(0, 0, canvas.width, canvas.height, 0);
  return crops;
}
export async function captureEvidence(
  source: FrameSource,
  time: number,
  roi: Region,
  prefix: string,
  save: AssetWriter,
  signal?: AbortSignal,
): Promise<Evidence> {
  checkAbort(signal);
  const frame = await source.capture(time, undefined, roi, signal);
  try {
    const sharpness = canvasFeature(frame.canvas).sharpness;
    const thumbnail = document.createElement("canvas");
    thumbnail.width = Math.min(768, frame.canvas.width);
    thumbnail.height = Math.max(
      1,
      Math.round((frame.canvas.height * thumbnail.width) / frame.canvas.width),
    );
    thumbnail.getContext("2d")!.drawImage(frame.canvas, 0, 0, thumbnail.width, thumbnail.height);
    const id = `${prefix}-thumb`;
    await save(id, await canvasPng(thumbnail));
    thumbnail.width = 0;
    thumbnail.height = 0;
    return {
      id: prefix,
      assetId: id,
      time: frame.timing,
      width: frame.canvas.width,
      height: frame.canvas.height,
      sharpness,
      roi: structuredClone(roi),
      crops: await cropCanvas(frame.canvas, prefix, save, signal),
    };
  } finally {
    frame.canvas.width = 0;
    frame.canvas.height = 0;
  }
}
