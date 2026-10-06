import type { Corners, SlideSettings } from "./types.ts";
export const PROMPT_VERSION = "slides-verbatim-1";
export const SCHEMA_VERSION = "slides-blocks-1";
export const MAX_REQUEST_BYTES = 3_500_000;
export const MAX_IMAGE_BYTES = 3_000_000;
export const MAX_IMAGE_DIMENSION = 8_192;
export const MAX_IMAGE_PIXELS = 16_777_216;
export const ASSET_LIMIT_BYTES = 128_000_000;
export const MAX_FILE_BYTES = 1_500_000_000;
export const MAX_DURATION = 7_200;
export const FULL_CORNERS: Corners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
export function defaultSlideSettings(): SlideSettings {
  return {
    sampleRate: 2,
    detectionWidth: 768,
    sensitivity: 1,
    refineStep: 0.2,
    stableSamples: 2,
    maxCandidates: 200,
    maxRequests: 400,
    budgetUsd: 5,
    allowance: 0.25,
    inputTokensPerMegapixel: 3_000,
    outputAllowance: 4_096,
    profile: "standard",
    regions: [{ time: 0, corners: structuredClone(FULL_CORNERS), method: "projective-mesh-v1" }],
    retryAllowance: 1,
  };
}
export class SlideFailure extends Error {
  readonly code: string;
  constructor(message: string, code = "local_failure") {
    super(message);
    this.name = "SlideFailure";
    this.code = code;
  }
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new SlideFailure(
      "Processing stopped. Completed evidence and text are kept.",
      "cancelled",
    );
}
