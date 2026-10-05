import { TRANSCRIPTION_CONFIG } from "./media-config.ts";
import type { ChunkPlan } from "./media-types.ts";

export type SilenceRange = { start: number; end: number };

export function selectBoundary(target: number, silences: SilenceRange[], duration: number): number {
  const config = TRANSCRIPTION_CONFIG.chunking;
  const candidates = silences
    .filter((silence) => silence.end - silence.start >= config.minimumSilenceMs / 1_000)
    .map((silence) => (silence.start + silence.end) / 2)
    .filter(
      (middle) =>
        middle > 0 &&
        middle < duration &&
        Math.abs(middle - target) <= config.boundarySearchWindowSec,
    );
  candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  return candidates[0] ?? target;
}

export function createChunkPlan(duration: number, silences: SilenceRange[] = []): ChunkPlan[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const boundaries = [0];
  for (
    let target = TRANSCRIPTION_CONFIG.chunking.targetCoreDurationSec;
    target < duration;
    target += TRANSCRIPTION_CONFIG.chunking.targetCoreDurationSec
  ) {
    const boundary = selectBoundary(target, silences, duration);
    if (boundary > boundaries[boundaries.length - 1]! && boundary < duration)
      boundaries.push(boundary);
  }
  boundaries.push(duration);
  return boundaries
    .slice(0, -1)
    .map((start, index) => makeChunkPlan(start, boundaries[index + 1]!, index, duration));
}

export function makeChunkPlan(
  coreStart: number,
  coreEnd: number,
  index: number,
  duration: number,
  id?: string,
): ChunkPlan {
  return {
    id: id ?? `chunk-${coreStart.toFixed(3)}-${coreEnd.toFixed(3)}`,
    index,
    coreStart,
    coreEnd,
    start: Math.max(0, coreStart - TRANSCRIPTION_CONFIG.chunking.prefixBufferSec),
    end: Math.min(duration, coreEnd + TRANSCRIPTION_CONFIG.chunking.suffixBufferSec),
  };
}

/** Replace an oversized core with smaller cores; all audio is still covered. */
export function splitOversizedChunk(
  plan: ChunkPlan,
  measuredBytes: number,
  duration: number,
): ChunkPlan[] {
  const config = TRANSCRIPTION_CONFIG.chunking;
  const coreDuration = plan.coreEnd - plan.coreStart;
  if (coreDuration <= config.minimumCoreDurationSec) return [];
  const parts = Math.max(2, Math.ceil(measuredBytes / config.targetMaxPayloadBytes));
  return Array.from({ length: parts }, (_, part) =>
    makeChunkPlan(
      plan.coreStart + (coreDuration * part) / parts,
      plan.coreStart + (coreDuration * (part + 1)) / parts,
      plan.index + part,
      duration,
      `${plan.id}.${part + 1}`,
    ),
  );
}

/** silencedetect emits local timestamps; callers add the short window's offset. */
export function parseSilenceLog(
  messages: string[],
  offset = 0,
  windowDuration?: number,
): SilenceRange[] {
  const ranges: SilenceRange[] = [];
  let start: number | undefined;
  for (const line of messages) {
    const begin = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (begin) start = Math.max(0, Number(begin[1]));
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && start !== undefined) {
      ranges.push({ start: offset + start, end: offset + Number(end[1]) });
      start = undefined;
    }
  }
  if (start !== undefined && windowDuration !== undefined)
    ranges.push({ start: offset + start, end: offset + windowDuration });
  return ranges;
}
