import type { CaptionTrack, Paragraph, Segment } from "./types.ts";
import { cueToSegment, explodeSpeakerMarks, fillSpeakerGaps, type Cue } from "./speakers.ts";

const SENTENCE_END = /[.!?…。？！]["'”’)]*$/;
const HANGUL = /[\uAC00-\uD7A3]/;
const NOISE_ONLY = /^\s*(\[[^\]]+\]|\([^)]+\)|♪+|♫+)\s*$/;
const LEADING_MARK = /^(?:>>|»)+\s*/;

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => {
      const code = Number.parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&([a-z]+);/gi, (full, name: string) => {
      switch (name.toLowerCase()) {
        case "amp":
          return "\u0026";
        case "lt":
          return "\u003c";
        case "gt":
          return "\u003e";
        case "quot":
          return "\u0022";
        case "apos":
          return "\u0027";
        case "nbsp":
          return " ";
        default:
          return full;
      }
    });
}

export function normalizeCueText(input: string): string {
  return decodeEntities(input)
    .replace(/\u00a0/g, " ")
    .replace(LEADING_MARK, "")
    .replace(/\s*[[(](?:음악|웃음|박수|intro|music|laughter|applause)[\])]\s*/gi, " ")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function foldKey(input: string): string {
  return input.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function compactLen(input: string): number {
  return foldKey(input).length;
}

function suffixPrefixOverlap(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  const floor = max >= 12 ? 4 : 2;
  for (let n = max; n >= floor; n--) {
    if (a.slice(-n) === b.slice(0, n)) return n;
  }
  return 0;
}

function joinCue(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next) && next.length < prev.length) return prev;
  const overlap = suffixPrefixOverlap(prev, next);
  if (overlap > 0) {
    const extra = next.slice(overlap).trim();
    return extra
      ? `${prev}${prev.endsWith(" ") || extra.startsWith(" ") ? "" : " "}${extra}`
          .replace(/\s+/g, " ")
          .trim()
      : prev;
  }
  const gap = /[\s([{‘“"'/-]$/.test(prev) || /^[\s.,!?…。？！)\]’”'"/-]/.test(next) ? "" : " ";
  return `${prev}${gap}${next}`.replace(/\s+/g, " ").trim();
}

export function dedupeRepeatedPhrases(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  let prev = "";
  for (let i = 0; i < 8 && t !== prev; i++) {
    prev = t;
    t = t.replace(/([^.!?…。？！]{4,}[.!?…。？！])(?:\s*\1)+/g, "$1");
    t = t.replace(/(.{6,}?)\s+\1(?=\s|$|[.!?…。？！])/g, "$1");
    t = t.replace(/([\uAC00-\uD7A3]{2,8})(?:\s*\1){2,}/g, "$1");
    t = t.replace(/\b([A-Za-z]{3,})\b(?:\s+\1\b){2,}/gi, "$1");
  }
  return t.replace(/\s+/g, " ").trim();
}

function pickLonger(prev: string, next: string): string {
  const a = foldKey(prev);
  const b = foldKey(next);
  if (b.startsWith(a) && b.length > a.length) return next;
  if (a.startsWith(b) && a.length >= b.length) return prev;
  if (b.includes(a) && b.length > a.length) return next;
  if (a.includes(b) && a.length >= b.length) return prev;
  return joinCue(prev, next);
}

function shouldCollapsePair(prev: string, next: string, gap: number): boolean {
  const a = foldKey(prev);
  const b = foldKey(next);
  if (!a || !b) return false;
  const close = gap < 4.2;
  if (!close && gap >= 0) return false;
  if (a === b) return true;
  if (b.startsWith(a) || a.startsWith(b)) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  const floor = HANGUL.test(prev + next) ? 2 : 4;
  return suffixPrefixOverlap(a, b) >= floor || suffixPrefixOverlap(prev, next) >= floor;
}

/** Collapse rolling-window ASR chips that repeat overlapping prefixes. */
export function collapseRollingCaptions(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const raw of segments) {
    const text = dedupeRepeatedPhrases(normalizeCueText(raw.text));
    if (!text) continue;
    if (out.length === 0) {
      out.push({ start: raw.start, duration: raw.duration, text, speaker: raw.speaker });
      continue;
    }
    const prev = out[out.length - 1]!;
    const gap = raw.start - (prev.start + prev.duration);
    if (shouldCollapsePair(prev.text, text, gap) || prev.text === text) {
      prev.text = dedupeRepeatedPhrases(pickLonger(prev.text, text));
      prev.duration = Math.max(prev.duration, raw.start + raw.duration - prev.start);
      continue;
    }
    out.push({ start: raw.start, duration: raw.duration, text, speaker: raw.speaker });
  }
  return out;
}

function isKoreanHeavy(text: string): boolean {
  const hangul = text.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
  return hangul >= 8 && hangul * 2 >= text.replace(/\s/g, "").length;
}

function shouldBreakSentence(prev: Cue, next: Cue, elapsed: number, isKo: boolean): boolean {
  if (next.speaker && prev.speaker && next.speaker !== prev.speaker) return true;
  if (next.turnMark && compactLen(prev.text) > 8) return true;
  if (compactLen(prev.text) <= 6 && elapsed < 5) return false;
  if (elapsed >= 3.2) return true;
  if (SENTENCE_END.test(prev.text)) return elapsed >= 0.25;
  if (!isKo && /[a-z0-9)]$/.test(prev.text) && /^[A-Z]/.test(next.text) && elapsed >= 0.8)
    return true;
  if (isKo && /(?:다|요|죠|니다|까요|세요)[.!?…]*$/.test(prev.text) && elapsed >= 0.45) return true;
  return false;
}

function mergeCues(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    const text = dedupeRepeatedPhrases(normalizeCueText(cue.text));
    if (!text || NOISE_ONLY.test(text)) {
      if (text && out.length > 0) {
        const prev = out[out.length - 1]!;
        if (compactLen(prev.text) < 8) prev.text = joinCue(prev.text, text);
      }
      continue;
    }
    const next: Cue = { ...cue, text };
    if (out.length === 0) {
      out.push(next);
      continue;
    }
    const prev = out[out.length - 1]!;
    const elapsed = next.start - (prev.start + prev.duration);
    const isKo = isKoreanHeavy(prev.text + next.text);
    if (shouldCollapsePair(prev.text, next.text, elapsed)) {
      prev.text = dedupeRepeatedPhrases(pickLonger(prev.text, next.text));
      prev.duration = Math.max(0.4, next.start + next.duration - prev.start);
      continue;
    }
    if (shouldBreakSentence(prev, next, elapsed, isKo) || prev.duration > 14) {
      out.push(next);
    } else {
      prev.text = dedupeRepeatedPhrases(joinCue(prev.text, next.text));
      prev.duration = Math.max(0.4, next.start + next.duration - prev.start);
    }
  }
  return out;
}

/** Merge caption chips into sentence-like cues. Keeps original wording. */
export function mergeIntoSentences(segments: Segment[]): Segment[] {
  return mergeCues(segments.map((s) => ({ ...s }))).map(cueToSegment);
}

function speakersDiffer(a?: string, b?: string): boolean {
  return Boolean(a && b && a !== b);
}

function shouldBreakParagraph(prev: Cue, next: Cue, elapsed: number, span: number): boolean {
  if (speakersDiffer(prev.speaker, next.speaker)) return true;
  if (next.turnMark && compactLen(prev.text) > 8) return true;
  if (compactLen(prev.text) <= 6 && elapsed < 5) return false;
  if (elapsed >= 2.6) return true;
  const punctuation = SENTENCE_END.test(prev.text) || /(?:다|요|죠|니다)\.?$/.test(prev.text);
  if (punctuation && elapsed >= 0.7) return true;
  if (punctuation && span >= 8) return true;
  if (span >= 14) return true;
  return false;
}

/** Group cues into readable turns — break on speaker change or a pause. */
export function groupParagraphs(segments: Segment[]): Paragraph[] {
  return groupCueParagraphs(segments.map((s) => ({ ...s })));
}

function groupCueParagraphs(cues: Cue[]): Paragraph[] {
  if (cues.length === 0) return [];
  const paragraphs: Paragraph[] = [];
  let bucket: Cue[] = [];
  let start = cues[0]!.start;
  let end = start;

  const flush = () => {
    if (bucket.length === 0) return;
    const text = dedupeRepeatedPhrases(
      bucket
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (text) {
      const speaker = bucket.find((c) => c.speaker)?.speaker;
      const turnMark = bucket.some((c) => c.turnMark);
      paragraphs.push({
        start,
        duration: Math.max(0.4, end - start),
        text,
        ...(speaker ? { speaker } : {}),
        ...(turnMark ? { turnMark: true } : {}),
      });
    }
    bucket = [];
  };

  for (const cue of cues) {
    if (bucket.length === 0) {
      bucket = [cue];
      start = cue.start;
      end = cue.start + cue.duration;
      continue;
    }
    const nextEnd = Math.max(end, cue.start + cue.duration);
    const elapsed = cue.start - end;
    const span = nextEnd - start;
    const last = bucket[bucket.length - 1]!;
    if (shouldCollapsePair(last.text, cue.text, elapsed)) {
      last.text = dedupeRepeatedPhrases(pickLonger(last.text, cue.text));
      last.duration = Math.max(last.duration, cue.start + cue.duration - last.start);
      end = nextEnd;
      continue;
    }
    if (shouldBreakParagraph(last, cue, elapsed, span)) {
      flush();
      bucket = [cue];
      start = cue.start;
      end = cue.start + cue.duration;
    } else {
      bucket.push(cue);
      end = nextEnd;
    }
  }
  flush();
  return mergeContainedParagraphs(paragraphs);
}

export function mergeContainedParagraphs(paragraphs: Paragraph[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const p of paragraphs) {
    const text = dedupeRepeatedPhrases(p.text);
    if (!text) continue;
    if (out.length === 0) {
      out.push({ ...p, text });
      continue;
    }
    const prev = out[out.length - 1]!;
    const gap = p.start - (prev.start + prev.duration);
    if (
      shouldCollapsePair(prev.text, text, gap) ||
      (gap < 1.2 && foldKey(prev.text) === foldKey(text))
    ) {
      prev.text = dedupeRepeatedPhrases(pickLonger(prev.text, text));
      prev.duration = Math.max(prev.duration, p.start + p.duration - prev.start);
      if (p.speaker && !prev.speaker) prev.speaker = p.speaker;
      continue;
    }
    out.push({ ...p, text });
  }
  return out;
}

export function cleanTranscript(raw: Segment[]): {
  segments: Segment[];
  paragraphs: Paragraph[];
} {
  const collapsed = collapseRollingCaptions(raw);
  const exploded = explodeSpeakerMarks(collapsed);
  const sentences = mergeCues(exploded.length > 0 ? exploded : collapsed.map((s) => ({ ...s })));
  const paragraphs = groupCueParagraphs(sentences.length > 0 ? sentences : exploded);
  const withSpeakers = paragraphs.some((p) => p.speaker) ? fillSpeakerGaps(paragraphs) : paragraphs;
  const segs = (sentences.length > 0 ? sentences : exploded).map(cueToSegment);
  return {
    segments: segs.length > 0 ? segs : collapsed,
    paragraphs: withSpeakers.length > 0 ? withSpeakers : segs,
  };
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatDurationClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function visibleTranscript(paragraphs: Paragraph[], mode: "off" | "inline" | "srt"): string {
  const lines: string[] = [];
  let lastSpeaker: string | undefined;
  paragraphs.forEach((paragraph, i) => {
    const ts = mode === "off" ? "" : `[${formatTimestamp(paragraph.start)}] `;
    const body = paragraph.text;
    if (mode === "srt") {
      if (lines.length) lines.push("");
      const speaker = paragraph.speaker ? `${paragraph.speaker}: ` : "";
      lines.push(`${i + 1}`);
      lines.push(`${speaker}${ts}${body}`.trim());
      lastSpeaker = paragraph.speaker;
      return;
    }
    if (paragraph.speaker) {
      if (paragraph.speaker !== lastSpeaker) {
        if (lines.length) lines.push("");
        lines.push(`${paragraph.speaker}: ${ts}${body}`.trim());
      } else {
        lines.push("");
        lines.push(`${ts}${body}`.trim());
      }
      lastSpeaker = paragraph.speaker;
      return;
    }
    if (lines.length) lines.push("");
    lines.push(`${ts}${body}`.trim());
    lastSpeaker = undefined;
  });
  return lines.join("\n");
}

export function wordCount(text: string): number {
  const hangul = text.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)?.length ?? 0;
  if (hangul > latin * 3) return hangul;
  return latin + hangul;
}

export function estimatedReadMinutes(text: string, language: string): number {
  const count = wordCount(text);
  const wpm = language.toLowerCase().startsWith("ko") || HANGUL.test(text) ? 380 : 220;
  return Math.max(1, Math.round(count / wpm) || 1);
}

export function langMatches(code: string, want: string): boolean {
  const c = code.toLowerCase();
  const w = want.toLowerCase();
  return c === w || c.startsWith(`${w}-`) || w.startsWith(`${c}-`);
}

export function pickTrack(
  tracks: CaptionTrack[],
  requested: "auto" | "ko" | "en",
): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const ranked = (want: string) => {
    const matches = tracks.filter((t) => langMatches(t.languageCode, want));
    return matches.find((t) => t.sourceType === "manual") ?? matches[0] ?? null;
  };
  if (requested !== "auto") return ranked(requested);
  return (
    ranked("ko") ??
    ranked("en") ??
    tracks.find((t) => t.sourceType === "manual") ??
    tracks[0] ??
    null
  );
}
