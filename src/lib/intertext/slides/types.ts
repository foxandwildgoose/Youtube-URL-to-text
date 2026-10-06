export type Point = { x: number; y: number };
/** Normalized original displayed-frame coordinates: TL, TR, BR, BL. */
export type Corners = [Point, Point, Point, Point];
export type Region = { time: number; corners: Corners; method: "projective-mesh-v1" };
export type FrameTiming = {
  requested: number;
  actual: number;
  method: "video-frame-callback" | "seeked-fallback" | "ffmpeg-pts";
  uncertaintySec: number;
};
export type Boundary = {
  low: number;
  high: number;
  method: FrameTiming["method"];
  uncertain: boolean;
};
export type SlideProfile = "standard" | "economy";
export type SlideFlag =
  | "unreadable"
  | "boundary-uncertain"
  | "clipped-region"
  | "possible-duplicate"
  | "dynamic"
  | "incomplete"
  | "occlusion"
  | "region-review";
export type TextBlock = {
  type: "heading" | "paragraph" | "list" | "table" | "code" | "formula" | "chart-label" | "footer";
  text: string;
  rows: string[][];
};
export type Extraction = {
  status: "text" | "textless" | "unreadable";
  blocks: TextBlock[];
  flags: string[];
  unreadable: string[];
};
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};
export type Pricing = {
  version: string;
  model: string;
  serviceTier: "default";
  verifiedOn: string;
  source: string;
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite: number;
};
export type ModelProfile = {
  id: SlideProfile;
  model: string;
  reasoning: "none" | "low";
  detail: "auto" | "high";
  maxOutputTokens: number;
  pricing: Pricing;
};
export type SlideConfiguration = {
  configured: boolean;
  message?: string;
  profiles: ModelProfile[];
  timeoutMs: number;
  maxRequestBytes: number;
  promptVersion: string;
  schemaVersion: string;
};
export type Crop = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  overlap: number;
  assetId: string;
  hash: string;
  sizeBytes: number;
};
export type Evidence = {
  id: string;
  assetId: string;
  time: FrameTiming;
  width: number;
  height: number;
  sharpness: number;
  roi: Region;
  crops: Crop[];
};
export type SlideError = {
  code: string;
  message: string;
  retryable?: boolean;
  retryAfterSec?: number;
  billing: "none" | "known" | "unknown";
  requestId?: string;
};
export type Attempt = {
  id: string;
  operationKey: string;
  cropId: string;
  model: string;
  profile: SlideProfile;
  promptVersion: string;
  schemaVersion: string;
  detail: string;
  outcome: "completed" | "failed" | "incomplete" | "unknown-billing";
  at: number;
  extraction?: Extraction;
  partialText?: string;
  usage?: Usage;
  costUsd?: number;
  reservedUsd?: number;
  requestId?: string;
  error?: SlideError;
  reusedFrom?: string;
};
export type DisplayState = {
  id: string;
  start: number;
  end: number;
  startBoundary: Boundary;
  endBoundary: Boundary;
  selected: boolean;
  groupId?: string;
  status: "pending" | "completed" | "failed" | "incomplete" | "unknown-billing" | "excluded";
  flags: SlideFlag[];
  evidence: Evidence[];
  representativeId: string;
  attempts: Attempt[];
  edits: Record<string, string>;
  acceptedAttemptIds?: Record<string, string>;
  note?: string;
};
export type AuditInterval = {
  id: string;
  start: number;
  end: number;
  kind: "black" | "transition" | "unobservable" | "excluded" | "dynamic";
  note: string;
};
export type SlideSettings = {
  sampleRate: number;
  detectionWidth: number;
  sensitivity: number;
  refineStep: number;
  stableSamples: number;
  maxCandidates: number;
  maxRequests: number;
  budgetUsd: number;
  allowance: number;
  inputTokensPerMegapixel: number;
  outputAllowance: number;
  profile: SlideProfile;
  regions: Region[];
  retryAllowance: number;
};
export type SlideData = {
  version: 1;
  status:
    | "ready"
    | "scanning"
    | "review"
    | "extracting"
    | "paused"
    | "cancelled"
    | "completed"
    | "failed";
  settings: SlideSettings;
  width: number;
  height: number;
  rotation: "browser-display" | number;
  decoder: "native" | "ffmpeg";
  scanCursor: number;
  scanComplete: boolean;
  states: DisplayState[];
  audit: AuditInterval[];
  approvedStateIds: string[];
  pricing?: ModelProfile[];
  unknownBilling: number;
  error?: string;
};
export interface FrameSource {
  duration: number;
  width: number;
  height: number;
  decoder: "native" | "ffmpeg";
  rotation: "browser-display" | number;
  capture(
    time: number,
    width?: number,
    region?: Region,
    signal?: AbortSignal,
  ): Promise<{ canvas: HTMLCanvasElement; timing: FrameTiming }>;
  close(): Promise<void>;
}
export type ImageOperation = {
  stateId: string;
  crop: Crop;
  blob: Blob;
  profile: ModelProfile;
  operationKey: string;
  signal: AbortSignal;
};
export type ProviderResult =
  | { ok: true; extraction: Extraction; usage?: Usage; requestId?: string; model: string }
  | { ok: false; error: SlideError; partialText?: string; usage?: Usage; model?: string };
export interface SlideProvider {
  extract(operation: ImageOperation): Promise<ProviderResult>;
}
