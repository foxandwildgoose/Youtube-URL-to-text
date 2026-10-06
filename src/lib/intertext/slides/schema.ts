import { z } from "zod";
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from "./config.ts";
import type { Extraction, SlideData, SlideSettings } from "./types.ts";
const positive = z.number().finite().nonnegative();
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const region = z
  .object({
    time: positive,
    corners: z.tuple([point, point, point, point]),
    method: z.literal("projective-mesh-v1"),
  })
  .strict();
export const settingsSchema = z
  .object({
    sampleRate: z.number().min(0.5).max(4),
    detectionWidth: z.number().int().min(192).max(1024),
    sensitivity: z.number().min(0.5).max(3),
    refineStep: z.number().min(0.1).max(0.25),
    stableSamples: z.number().int().min(2).max(4),
    maxCandidates: z.number().int().min(2).max(1000),
    maxRequests: z.number().int().min(1).max(2000),
    budgetUsd: z.number().min(0.01).max(1000),
    allowance: z.number().min(0).max(2),
    inputTokensPerMegapixel: z.number().min(100).max(100_000),
    outputAllowance: z.number().int().min(512).max(8192),
    profile: z.enum(["standard", "economy"]),
    regions: z.array(region).min(1).max(1000),
    retryAllowance: z.number().int().min(0).max(2),
  })
  .strict();
export const extractionSchema = z
  .object({
    status: z.enum(["text", "textless", "unreadable"]),
    blocks: z
      .array(
        z
          .object({
            type: z.enum([
              "heading",
              "paragraph",
              "list",
              "table",
              "code",
              "formula",
              "chart-label",
              "footer",
            ]),
            text: z.string().max(100_000),
            rows: z.array(z.array(z.string().max(10_000)).max(100)).max(300),
          })
          .strict(),
      )
      .max(500),
    flags: z.array(z.string().max(300)).max(100),
    unreadable: z.array(z.string().max(1000)).max(200),
  })
  .strict();
export function validateExtraction(value: unknown): Extraction {
  const result = extractionSchema.parse(value);
  if (result.status === "textless" && result.blocks.length)
    throw new Error("A textless extraction must have no text blocks.");
  for (const block of result.blocks) {
    if (block.type !== "table" && block.rows.length)
      throw new Error("Only table blocks may contain cells.");
    if (block.type === "table" && block.rows.some((row) => row.length !== block.rows[0]?.length))
      throw new Error("Table columns must preserve visible empty cells.");
  }
  return result;
}
const timing = z
  .object({
    requested: positive,
    actual: positive,
    method: z.enum(["video-frame-callback", "seeked-fallback", "ffmpeg-pts"]),
    uncertaintySec: positive,
  })
  .strict();
const boundary = z
  .object({ low: positive, high: positive, method: timing.shape.method, uncertain: z.boolean() })
  .strict()
  .refine((v) => v.high >= v.low);
const crop = z
  .object({
    id: z.string().min(1).max(128),
    x: positive,
    y: positive,
    width: z.number().int().positive().max(MAX_IMAGE_DIMENSION),
    height: z.number().int().positive().max(MAX_IMAGE_DIMENSION),
    fullWidth: positive,
    fullHeight: positive,
    overlap: positive,
    assetId: z.string().min(1).max(200),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: positive,
  })
  .strict()
  .refine(
    (v) =>
      v.x + v.width <= v.fullWidth &&
      v.y + v.height <= v.fullHeight &&
      v.width * v.height <= MAX_IMAGE_PIXELS,
  );
const evidence = z
  .object({
    id: z.string().min(1).max(128),
    assetId: z.string().min(1).max(200),
    time: timing,
    width: positive,
    height: positive,
    sharpness: positive,
    roi: region,
    crops: z.array(crop).max(200),
  })
  .strict();
const usage = z
  .object({
    inputTokens: positive,
    outputTokens: positive,
    cachedInputTokens: positive,
    cacheWriteTokens: positive,
    reasoningTokens: positive,
  })
  .strict();
const error = z
  .object({
    code: z.string().max(100),
    message: z.string().max(1000),
    retryable: z.boolean().optional(),
    retryAfterSec: positive.optional(),
    billing: z.enum(["none", "known", "unknown"]),
    requestId: z.string().max(200).optional(),
  })
  .strict();
const attempt = z
  .object({
    id: z.string().min(1),
    operationKey: z.string().max(1000),
    cropId: z.string().max(128),
    model: z.string().max(100),
    profile: z.enum(["standard", "economy"]),
    promptVersion: z.string().max(100),
    schemaVersion: z.string().max(100),
    detail: z.string().max(20),
    outcome: z.enum(["completed", "failed", "incomplete", "unknown-billing"]),
    at: positive,
    extraction: extractionSchema.optional(),
    partialText: z.string().max(100_000).optional(),
    usage: usage.optional(),
    costUsd: positive.optional(),
    reservedUsd: positive.optional(),
    requestId: z.string().max(200).optional(),
    error: error.optional(),
    reusedFrom: z.string().max(128).optional(),
  })
  .strict();
const state = z
  .object({
    id: z.string().min(1).max(128),
    start: positive,
    end: positive,
    startBoundary: boundary,
    endBoundary: boundary,
    selected: z.boolean(),
    groupId: z.string().max(128).optional(),
    status: z.enum(["pending", "completed", "failed", "incomplete", "unknown-billing", "excluded"]),
    flags: z
      .array(
        z.enum([
          "unreadable",
          "boundary-uncertain",
          "clipped-region",
          "possible-duplicate",
          "dynamic",
          "incomplete",
          "occlusion",
          "region-review",
        ]),
      )
      .max(20),
    evidence: z.array(evidence).max(3),
    representativeId: z.string().max(128),
    attempts: z.array(attempt).max(5000),
    edits: z.record(z.string().max(200), z.string().max(100_000)),
    acceptedAttemptIds: z.record(z.string().max(128), z.string().max(128)).optional(),
    note: z.string().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.end >= v.start);
const pricing = z
  .object({
    version: z.string(),
    model: z.string(),
    serviceTier: z.literal("default"),
    verifiedOn: z.string(),
    source: z.string().url(),
    input: positive,
    output: positive,
    cachedInput: positive,
    cacheWrite: positive,
  })
  .strict();
const profile = z
  .object({
    id: z.enum(["standard", "economy"]),
    model: z.string(),
    reasoning: z.enum(["none", "low"]),
    detail: z.enum(["auto", "high"]),
    maxOutputTokens: z.number().int().min(512).max(8192),
    pricing,
  })
  .strict();
export const slideDataSchema = z
  .object({
    version: z.literal(1),
    status: z.enum([
      "ready",
      "scanning",
      "review",
      "extracting",
      "paused",
      "cancelled",
      "completed",
      "failed",
    ]),
    settings: settingsSchema,
    width: positive,
    height: positive,
    rotation: z.union([z.literal("browser-display"), z.number().finite()]),
    decoder: z.enum(["native", "ffmpeg"]),
    scanCursor: positive,
    scanComplete: z.boolean(),
    states: z.array(state).max(5000),
    audit: z
      .array(
        z
          .object({
            id: z.string(),
            start: positive,
            end: positive,
            kind: z.enum(["black", "transition", "unobservable", "excluded", "dynamic"]),
            note: z.string().max(1000),
          })
          .strict(),
      )
      .max(20_000),
    approvedStateIds: z.array(z.string()).max(5000),
    pricing: z.array(profile).max(2).optional(),
    unknownBilling: positive,
    error: z.string().max(1000).optional(),
  })
  .strict();
export function validateSlideData(value: unknown): SlideData {
  return slideDataSchema.parse(value);
}
export function validateSlideSettings(value: unknown): SlideSettings {
  return settingsSchema.parse(value);
}
