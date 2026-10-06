import type { DisplayState, ModelProfile, Pricing, Usage } from "./types.ts";
export const PRICING: Record<"gpt-6.1-sol" | "gpt-6-luna", Pricing> = {
  "gpt-6.1-sol": {
    version: "2026-10-06-standard-short",
    model: "gpt-6.1-sol",
    serviceTier: "default",
    verifiedOn: "2026-10-06",
    source: "https://developers.openai.com/api/docs/pricing",
    input: 2,
    output: 10,
    cachedInput: 0.1,
    cacheWrite: 2.5,
  },
  "gpt-6-luna": {
    version: "2026-10-06-standard-short",
    model: "gpt-6-luna",
    serviceTier: "default",
    verifiedOn: "2026-10-06",
    source: "https://developers.openai.com/api/docs/pricing",
    input: 0.1,
    output: 0.5,
    cachedInput: 0.01,
    cacheWrite: 0.125,
  },
};
export function usageCost(usage: Usage, pricing: Pricing): number {
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const writes = Math.min(usage.inputTokens - cached, usage.cacheWriteTokens);
  return (
    ((usage.inputTokens - cached - writes) * pricing.input +
      cached * pricing.cachedInput +
      writes * pricing.cacheWrite +
      usage.outputTokens * pricing.output) /
    1_000_000
  );
}
export function hypotheticalCost(
  calls: number,
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing,
  allowance = 0,
): number {
  return (
    ((calls * (inputTokens * pricing.input + outputTokens * pricing.output)) / 1_000_000) *
    (1 + allowance)
  );
}
/** Heuristic planning allowance, NOT a model-specific image token formula or guaranteed maximum. */
export function operationEstimate(
  width: number,
  height: number,
  profile: ModelProfile,
  tokensPerMegapixel: number,
  outputTokens: number,
  allowance: number,
): number {
  const input = 1_500 + Math.ceil(((width * height) / 1_000_000) * tokensPerMegapixel);
  return hypotheticalCost(
    1,
    input,
    Math.min(outputTokens, profile.maxOutputTokens),
    profile.pricing,
    allowance,
  );
}
export function knownCost(states: DisplayState[]): number {
  return states
    .flatMap((s) => s.attempts)
    .reduce((sum, attempt) => sum + (attempt.reusedFrom ? 0 : (attempt.costUsd ?? 0)), 0);
}
