import type { Job } from "../types.ts";
import { createHash } from "node:crypto";
export const TEST_ASSETS = new Map<string, Blob>();
import { defaultSlideSettings } from "./config.ts";
import { PRICING } from "./pricing.ts";
import type { DisplayState, Extraction, ModelProfile } from "./types.ts";
export const TEST_PROFILE: ModelProfile = {
  id: "standard",
  model: "gpt-6.1-sol",
  reasoning: "low",
  detail: "auto",
  maxOutputTokens: 4096,
  pricing: PRICING["gpt-6.1-sol"],
};
export const TEST_TEXT: Extraction = {
  status: "text",
  blocks: [
    { type: "heading", text: "AI 보안 / NVIDIA", rows: [] },
    { type: "code", text: 'if x < 4:\n    print("HBM4")', rows: [] },
    {
      type: "table",
      text: "",
      rows: [
        ["GPU", "수량"],
        ["Rubin", ""],
        ["Blackwell", "4"],
      ],
    },
  ],
  flags: [],
  unreadable: [],
};
export function testState(id = "state-1", hash = "a".repeat(64)): DisplayState {
  const blob = new Blob([hash], { type: "image/png" });
  TEST_ASSETS.set(`${id}-crop`, blob);
  hash = createHash("sha256").update(hash).digest("hex");
  return {
    id,
    start: 0,
    end: 3,
    startBoundary: { low: 0, high: 0.2, method: "video-frame-callback", uncertain: true },
    endBoundary: { low: 2.9, high: 3.1, method: "video-frame-callback", uncertain: true },
    selected: true,
    status: "pending",
    flags: ["boundary-uncertain"],
    evidence: [
      {
        id: `${id}-ev`,
        assetId: `${id}-thumb`,
        time: { requested: 1, actual: 1.04, method: "video-frame-callback", uncertaintySec: 0.04 },
        width: 640,
        height: 360,
        sharpness: 0.4,
        roi: {
          time: 0,
          corners: defaultSlideSettings().regions[0]!.corners,
          method: "projective-mesh-v1",
        },
        crops: [
          {
            id: `${id}-crop`,
            x: 0,
            y: 0,
            width: 640,
            height: 360,
            fullWidth: 640,
            fullHeight: 360,
            overlap: 32,
            assetId: `${id}-crop`,
            hash,
            sizeBytes: 200,
          },
        ],
      },
    ],
    representativeId: `${id}-ev`,
    attempts: [],
    edits: {},
  };
}
export function testJob(states = [testState()]): Job {
  return {
    id: "visual-job",
    processingMode: "slides",
    source: {
      kind: "upload",
      fileName: "conference.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1000,
      lastModified: 1,
      fingerprint: "sample-hash",
    },
    title: "AI conference",
    language: "visible original",
    requestedLang: "auto",
    sourceType: "visual",
    provider: "openai",
    providerLabel: "Slide image extraction",
    segmentCount: 0,
    durationSec: 10,
    createdAt: 1,
    segments: [],
    paragraphs: [],
    availableLanguages: [],
    summaryKind: "general",
    summary: "",
    timestampQuality: "none",
    slides: {
      version: 1,
      status: "review",
      settings: defaultSlideSettings(),
      width: 640,
      height: 360,
      rotation: "browser-display",
      decoder: "native",
      scanCursor: 10,
      scanComplete: true,
      states,
      audit: [],
      approvedStateIds: states.map((s) => s.id),
      unknownBilling: 0,
    },
  };
}
