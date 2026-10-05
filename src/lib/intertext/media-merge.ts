import { TRANSCRIPTION_CONFIG } from "./media-config.ts";
import type { ChunkCheckpoint, ContentMode, MergeAudit } from "./media-types.ts";
import type { Paragraph, Segment } from "./types.ts";

type Token = { text: string; start: number; end: number };
const tokens = (text: string): Token[] =>
  Array.from(text.matchAll(/[^\s.!?。！？]+[.!?。！？]*/gu), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));

/** Matching only. Original words and spelling always remain in the raw checkpoint. */
export function normalizeOverlapText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function comparisonKey(text: string): string {
  // A narrowly scoped bilingual proper-name equivalence, never an output rewrite.
  return normalizeOverlapText(text).replace(/엔비디아/g, "nvidia");
}

export function overlapSimilarity(left: string, right: string): number {
  const a = Array.from(comparisonKey(left));
  const b = Array.from(comparisonKey(right));
  if (!a.length || !b.length) return 0;
  if (a.join("") === b.join("")) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length);
}

type BoundaryMatch = {
  similarity: number;
  remove: number;
  method: string;
  confidence: "high" | "possible" | "none";
};

export function matchChunkBoundary(
  previous: ChunkCheckpoint,
  next: ChunkCheckpoint,
  contentMode: ContentMode,
): BoundaryMatch {
  const config = TRANSCRIPTION_CONFIG.merge;
  const overlapSec = previous.end - next.start;
  const none: BoundaryMatch = { similarity: 0, remove: 0, method: "none", confidence: "none" };
  // Only adjacent cores with a real shared audio interval qualify.
  if (
    overlapSec <= 0 ||
    Math.abs(previous.coreEnd - next.coreStart) > 0.05 ||
    contentMode === "lyrics"
  )
    return none;
  const maxWords = Math.min(
    config.previousSuffixWords,
    config.nextPrefixWords,
    Math.ceil(overlapSec * config.maximumWordsPerOverlapSecond),
  );
  const maxChars = Math.ceil(overlapSec * config.maximumCharsPerOverlapSecond);
  const left = tokens(previous.transcript.text)
    .slice(-maxWords)
    .filter((token) => previous.transcript.text.length - token.start <= maxChars);
  const right = tokens(next.transcript.text)
    .slice(0, maxWords)
    .filter((token) => token.end <= maxChars);
  let best = none;
  // Character matching also handles Korean spacing changes that alter the number
  // of word tokens dramatically. Consider only prefix endpoints, bounded by audio.
  const suffix = normalizeOverlapText(previous.transcript.text.slice(-maxChars));
  for (const endpoint of right) {
    const prefix = normalizeOverlapText(next.transcript.text.slice(0, endpoint.end));
    if (prefix.length >= config.minimumMatchChars && suffix.endsWith(prefix))
      best = {
        similarity: 1,
        remove: endpoint.end,
        method: "normalized-exact",
        confidence: "high",
      };
  }
  for (let leftCount = Math.min(left.length, maxWords); leftCount >= 1; leftCount--) {
    const a = previous.transcript.text.slice(left[left.length - leftCount]!.start).trim();
    if (normalizeOverlapText(a).length < config.minimumMatchChars) continue;
    for (
      let rightCount = Math.max(1, leftCount - 2);
      rightCount <= Math.min(right.length, leftCount + 2);
      rightCount++
    ) {
      const end = right[rightCount - 1]!.end;
      const b = next.transcript.text.slice(0, end).trim();
      if (normalizeOverlapText(b).length < config.minimumMatchChars) continue;
      const normalizedExact = normalizeOverlapText(a) === normalizeOverlapText(b);
      const similarity = normalizedExact ? 1 : overlapSimilarity(a, b);
      if (similarity < config.possibleOverlapThreshold) continue;
      // Fuzzy deletion additionally needs identical beginning/end anchors. The
      // narrow NVIDIA alias can bridge the beginning; following words still agree.
      const aKey = comparisonKey(a);
      const bKey = comparisonKey(b);
      const strongAnchors =
        aKey.slice(-8) === bKey.slice(-8) &&
        (aKey.slice(0, 8) === bKey.slice(0, 8) || aKey.slice(8, 16) === bKey.slice(8, 16));
      const high = normalizedExact || (similarity >= config.autoRemoveThreshold && strongAnchors);
      if (high && (best.confidence !== "high" || end > best.remove))
        best = {
          similarity,
          remove: end,
          method: normalizedExact ? "normalized-exact" : "fuzzy-anchored",
          confidence: "high",
        };
      else if (!high && best.confidence !== "high" && similarity > best.similarity)
        best = { similarity, remove: 0, method: "ambiguous-kept", confidence: "possible" };
    }
  }
  return best;
}

/** No caption cleaner: its rolling-caption/global repetition rules erase real speech. */
export function mergeChunkTranscripts(
  checkpoints: ChunkCheckpoint[],
  contentMode: ContentMode,
): { segments: Segment[]; paragraphs: Paragraph[]; audit: MergeAudit[]; text: string } {
  const ordered = [...checkpoints].sort((a, b) => a.coreStart - b.coreStart);
  const segments: Segment[] = [];
  const audit: MergeAudit[] = [];
  ordered.forEach((chunk, index) => {
    const previous = ordered[index - 1];
    let text = chunk.transcript.text.trim();
    if (previous) {
      const match = matchChunkBoundary(previous, chunk, contentMode);
      audit.push({
        previousChunkId: previous.id,
        nextChunkId: chunk.id,
        similarity: match.similarity,
        removedTextLength: match.remove,
        matchMethod: match.method,
        confidence: match.confidence,
      });
      if (match.remove > 0) text = chunk.transcript.text.slice(match.remove).trim();
    }
    if (text)
      segments.push({ start: chunk.coreStart, duration: chunk.coreEnd - chunk.coreStart, text });
  });
  // Coarse chunk estimates only: the plain-text provider does not return word timings.
  const paragraphs = segments.map((segment) => ({ ...segment }));
  return {
    segments,
    paragraphs,
    audit,
    text: paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
  };
}
