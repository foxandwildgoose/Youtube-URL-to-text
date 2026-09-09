import type { Paragraph, Segment } from "./types.ts";

const SPEAKER_MARK = /^(?:>>|»)+/;
const SPLIT_MARK = /(>>+|»+)/;

const FALSE_SPEAKERS = new Set([
  "http",
  "https",
  "time",
  "note",
  "update",
  "warning",
  "music",
  "applause",
  "laughter",
  "narrator",
  "summary",
  "overview",
  "transcript",
  "자막",
  "음악",
  "박수",
  "웃음",
  "시간",
  "요약",
  "제목",
]);

export type Cue = Segment & { turnMark?: boolean };

export type SpeakerTurn = { i: number; speaker: string };

export function isFalseSpeaker(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 40) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (/^[A-Za-z]$/.test(trimmed)) return true;
  if (trimmed.split(/\s+/).length > 3) return true;
  if (/^(chapter|part|scene|track|http|speaker)\b/i.test(trimmed)) return true;
  if (/[요다죠네임음]$/.test(trimmed) && trimmed.length > 5) return true;
  return FALSE_SPEAKERS.has(trimmed.toLowerCase());
}

export function peelSpeaker(input: string): {
  speaker?: string;
  text: string;
  turnMark: boolean;
} {
  let t = input.replace(/\u00a0/g, " ").trim();
  let turnMark = false;
  while (SPEAKER_MARK.test(t)) {
    turnMark = true;
    t = t.replace(SPEAKER_MARK, "").trim();
  }
  const labeled = t.match(
    /^(?:\[([^\]]{1,40})\]|([A-Za-z가-힣][A-Za-z가-힣0-9 .'-]{0,32}))\s*[:：]\s+([\s\S]+)$/,
  );
  if (labeled) {
    const name = (labeled[1] || labeled[2] || "").trim();
    if (name && (!isFalseSpeaker(name) || /^[A-Za-z]$/.test(name))) {
      return { speaker: normalizeSpeaker(name), text: labeled[3]!.trim(), turnMark: true };
    }
  }
  return { speaker: undefined, text: t, turnMark };
}

export function normalizeSpeaker(name: string): string {
  const trimmed = name.trim();
  if (/^speaker\s*(\d+)$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, " ");
  }
  return trimmed;
}

/** Split a cue on interior >> / » and lift "Name:" prefixes. Frequent leading >> is ASR chrome, not a speaker change. */
export function explodeSpeakerMarks(segments: Segment[]): Cue[] {
  if (segments.length === 0) return [];
  const leading = segments.filter((s) => SPEAKER_MARK.test(s.text.trim())).length;
  const frequentLead = leading / segments.length >= 0.35;

  const out: Cue[] = [];
  for (const seg of segments) {
    const raw = seg.text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const stripped = raw.replace(/^(?:>>|»)+\s*/, "");
    if (!stripped) continue;

    if (frequentLead) {
      const interior = stripped.split(SPLIT_MARK);
      const hasInterior = interior.length > 2;
      if (!hasInterior) {
        const peeled = peelSpeaker(stripped);
        out.push({
          start: seg.start,
          duration: seg.duration,
          text: peeled.text,
          speaker: peeled.speaker ?? seg.speaker,
          turnMark: Boolean(peeled.speaker),
        });
        continue;
      }
    }

    const source = frequentLead ? stripped : raw;
    const parts = source.split(SPLIT_MARK);
    const bodyParts = parts.filter((_, i) => i % 2 === 0).map((p) => p.trim()).filter(Boolean);
    const totalLen = bodyParts.reduce((n, p) => n + p.length, 0) || 1;
    let t = 0;
    let marked = !frequentLead && SPEAKER_MARK.test(raw);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        marked = true;
        continue;
      }
      const piece = parts[i]!.trim();
      if (!piece) continue;
      const peeled = peelSpeaker(piece);
      const ratio = Math.max(piece.length, 1) / totalLen;
      const dur = Math.max(0.25, seg.duration * ratio);
      out.push({
        start: seg.start + t,
        duration: dur,
        text: peeled.text,
        speaker: peeled.speaker ?? seg.speaker,
        turnMark: frequentLead ? Boolean(peeled.speaker) : marked || peeled.turnMark,
      });
      t += dur;
      marked = false;
    }
  }
  return out;
}

export function fillSpeakerGaps(paragraphs: Paragraph[]): Paragraph[] {
  const fwd: Paragraph[] = [];
  let current: string | undefined;
  for (const p of paragraphs) {
    if (p.speaker) current = p.speaker;
    fwd.push({ ...p, speaker: p.speaker || current });
  }
  let next: string | undefined;
  for (let i = fwd.length - 1; i >= 0; i--) {
    if (fwd[i]!.speaker) next = fwd[i]!.speaker;
    else if (next) fwd[i] = { ...fwd[i]!, speaker: next };
  }
  return fwd;
}

export function speakersFromSummary(summary: string): string[] {
  const names: string[] = [];
  const re =
    /(?:^|\n)\s*[-*•]?\s*(?:\*\*)?([A-Za-z가-힣][A-Za-z가-힣0-9·.\s]{0,24}?)(?:\*\*)?\s*[:：]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(summary))) {
    const name = match[1]!.replace(/\s+/g, " ").trim();
    if (!name || isFalseSpeaker(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names.slice(0, 6);
}

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return /[?？]\s*$/.test(t) || /(?:까요|나요|세요|습니까|입니까|죠)\??\s*$/.test(t);
}

/**
 * Interview-only: host vs guest on existing paragraphs. Does not invent lines.
 * Questions and short follow-ups → first name (진행자). Longer replies → second name.
 */
export function labelInterviewByRole(paragraphs: Paragraph[], speakers: string[]): Paragraph[] {
  const names = speakers
    .map((s) => s.trim())
    .filter((s) => s && !isFalseSpeaker(s) && !/^[A-Za-z]$/.test(s));
  if (names.length === 0) {
    return paragraphs.map((p) => {
      if (p.speaker && /^[A-Za-z]$/.test(p.speaker)) {
        const next = { ...p };
        delete next.speaker;
        return next;
      }
      return p;
    });
  }
  if (names.length === 1) {
    return paragraphs.map((p) => ({
      ...p,
      speaker: remapSpeaker(p.speaker, names) ?? names[0],
    }));
  }

  const host = names[0]!;
  const guest = names[1]!;
  let last = host;
  return paragraphs.map((p, i) => {
    const existing = p.speaker && !/^[A-Za-z]$/.test(p.speaker) ? remapSpeaker(p.speaker, names) ?? p.speaker : undefined;
    if (existing) {
      last = existing;
      return { ...p, speaker: existing };
    }
    const compact = p.text.replace(/\s+/g, "").length;
    const hangul = p.text.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
    const long = compact > 24 || hangul > 16;
    const brief = compact < 14 && hangul < 10;
    let speaker = last;
    if (looksLikeQuestion(p.text)) speaker = host;
    else if (long && last === host) speaker = guest;
    else if (brief && last === guest && i > 0) speaker = host;
    last = speaker;
    return { ...p, speaker };
  });
}

function remapSpeaker(raw: string | undefined, names: string[]): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^[A-Za-z]$/.test(trimmed)) {
    const idx = trimmed.toUpperCase().charCodeAt(0) - 65;
    return names[idx];
  }
  const speakerN = trimmed.match(/^speaker\s*(\d+)$/i);
  if (speakerN) {
    const n = Number(speakerN[1]);
    return names[Math.max(0, n - 1)];
  }
  const hit = names.find((n) => n === trimmed || n.toLowerCase() === trimmed.toLowerCase());
  if (hit) return hit;
  if (!isFalseSpeaker(trimmed) && !/^[A-Za-z]$/.test(trimmed)) return trimmed;
  return undefined;
}

/**
 * Label existing paragraphs with real names. Never invents lines.
 * Single-letter A/B labels are remapped onto `speakers` (진행자, 성상현, …).
 */
export function applySpeakerNames(
  paragraphs: Paragraph[],
  speakers: string[],
  turns?: SpeakerTurn[],
): Paragraph[] {
  const names = speakers.map((s) => s.trim()).filter((s) => s && !isFalseSpeaker(s) && !/^[A-Za-z]$/.test(s));
  if (turns && turns.length > 0) {
    const byIndex = new Map<number, string>();
    for (const t of turns) {
      if (!Number.isInteger(t.i) || t.i < 0 || t.i >= paragraphs.length) continue;
      const name = remapSpeaker(t.speaker, names);
      if (name) byIndex.set(t.i, name);
    }
    let last: string | undefined;
    return paragraphs.map((p, i) => {
      const speaker = byIndex.get(i) ?? remapSpeaker(p.speaker, names) ?? last;
      if (speaker) last = speaker;
      return speaker ? { ...p, speaker } : { ...p, speaker: undefined };
    });
  }

  return paragraphs.map((p) => {
    const speaker = remapSpeaker(p.speaker, names);
    if (speaker) return { ...p, speaker };
    const next = { ...p };
    delete next.speaker;
    return next;
  });
}

export function cueToSegment(cue: Cue): Segment {
  return {
    start: cue.start,
    duration: cue.duration,
    text: cue.text,
    ...(cue.speaker ? { speaker: cue.speaker } : {}),
  };
}

export function attachSpeakersToSegments(segments: Segment[], paragraphs: Paragraph[]): Segment[] {
  if (paragraphs.length === 0) return segments;
  return segments.map((s) => {
    if (s.speaker && !/^[A-Za-z]$/.test(s.speaker)) return s;
    const hit = paragraphs.find(
      (p) => s.start >= p.start - 0.05 && s.start <= p.start + p.duration + 0.15,
    );
    return hit?.speaker ? { ...s, speaker: hit.speaker } : s;
  });
}
