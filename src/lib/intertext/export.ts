import { formatSrtTime, formatTimestamp, visibleTranscript } from "./clean.ts";
import {
  SUMMARY_KINDS,
  type Job,
  type Paragraph,
  type Segment,
  type TimestampMode,
} from "./types.ts";

export type ExportOptions = {
  timestamps?: boolean;
  speakers?: boolean;
  summary?: boolean;
};

export function sanitizeFilename(title: string, fallback = "transcript"): string {
  const base = Array.from((title || fallback).normalize("NFC"))
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return base || fallback;
}

function documentTitle(job: Job): string {
  return (
    job.title.trim() ||
    (job.source?.kind === "upload" ? job.source.fileName : job.videoId) ||
    "Transcript"
  );
}

export function exportBasename(job: Job): string {
  const uploadName =
    job.source?.kind === "upload" ? job.source.fileName.replace(/\.[^.]+$/, "") : "";
  return sanitizeFilename(
    job.title.trim() || uploadName || job.videoId || "transcript",
    "transcript",
  );
}

export function summaryKindLabel(kind: Job["summaryKind"]): string {
  return SUMMARY_KINDS.find((k) => k.id === kind)?.label ?? "General";
}

function transcript(job: Job, mode: TimestampMode, options: ExportOptions): string {
  const showTimestamps = options.timestamps ?? mode !== "off";
  const paragraphs =
    options.speakers === false
      ? job.paragraphs.map((paragraph) => ({ ...paragraph, speaker: undefined }))
      : job.paragraphs;
  return visibleTranscript(paragraphs, showTimestamps ? "inline" : "off");
}

function sourceLabel(job: Job): string | undefined {
  if (job.source?.kind === "upload") return job.source.fileName;
  return job.source?.kind === "youtube" ? job.source.url : job.url;
}

function sourceTypeLabel(job: Job): string {
  if (job.sourceType === "transcription") return "Transcribed audio";
  return job.sourceType === "asr" ? "Auto-generated" : "Manual";
}

export function composeDocument(
  job: Job,
  mode: TimestampMode,
  options: ExportOptions = {},
): string {
  const summary = options.summary === false ? "" : (job.summary || "").trim();
  const body = transcript(job, mode, options);
  const parts = [documentTitle(job), ""];
  if (summary) parts.push(`Summary (${summaryKindLabel(job.summaryKind)})`, summary, "");
  parts.push(body.trim());
  return `${parts.join("\n").trim()}\n`;
}

export function buildTxt(job: Job, mode: TimestampMode, options: ExportOptions = {}): string {
  return composeDocument(job, mode, options);
}

export function buildMarkdown(job: Job, mode: TimestampMode, options: ExportOptions = {}): string {
  const body = transcript(job, mode, options);
  const summary = options.summary === false ? "" : (job.summary || "").trim();
  const source = sourceLabel(job);
  const lines = [`# ${documentTitle(job)}`, ""];
  if (source) lines.push(`Source: ${source}`);
  lines.push(
    `Language: ${job.language} (${sourceTypeLabel(job)})`,
    `Provider: ${job.providerLabel}`,
    "",
  );
  if (summary) lines.push(`## Summary (${summaryKindLabel(job.summaryKind)})`, "", summary, "");
  lines.push("## Transcript", "", body, "");
  return lines.join("\n");
}

function cueText(segment: Segment, options: ExportOptions): string {
  return `${options.speakers !== false && segment.speaker ? `${segment.speaker}: ` : ""}${segment.text}`;
}

export function buildSrt(job: Job, options: ExportOptions = {}): string {
  return job.segments
    .map((segment, index) => {
      const start = formatSrtTime(segment.start);
      const end = formatSrtTime(segment.start + Math.max(segment.duration, 0.4));
      return `${index + 1}\n${start} --> ${end}\n${cueText(segment, options)}`;
    })
    .join("\n\n")
    .concat("\n");
}

export function buildVtt(job: Job, options: ExportOptions = {}): string {
  const cues = job.segments.map((segment, index) => {
    const start = formatSrtTime(segment.start).replace(",", ".");
    const end = formatSrtTime(segment.start + Math.max(segment.duration, 0.4)).replace(",", ".");
    // VTT treats angle brackets as cue markup. Escape them to preserve literal text.
    const text = cueText(segment, options)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `${index + 1}\n${start} --> ${end}\n${text}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
}

export function buildJson(job: Job, options: ExportOptions = {}): string {
  const showTimestamps = options.timestamps !== false;
  const showSpeakers = options.speakers !== false;
  const entry = (value: Segment | Paragraph) => ({
    ...(showTimestamps ? { start: value.start, duration: value.duration } : {}),
    text: value.text,
    ...(showSpeakers && value.speaker ? { speaker: value.speaker } : {}),
  });
  return `${JSON.stringify(
    {
      ...(job.id ? { id: job.id } : {}),
      ...(job.source ? { source: job.source } : {}),
      ...(job.source?.kind !== "upload" && job.videoId ? { videoId: job.videoId } : {}),
      ...(job.source?.kind !== "upload" && job.url ? { url: job.url } : {}),
      language: job.language,
      sourceType: job.sourceType,
      title: documentTitle(job),
      provider: job.provider,
      timestampQuality: job.timestampQuality ?? (job.source?.kind === "upload" ? "none" : "source"),
      ...(options.summary !== false ? { summaryKind: job.summaryKind, summary: job.summary } : {}),
      segments: job.segments.map(entry),
      paragraphs: job.paragraphs.map(entry),
    },
    null,
    2,
  )}\n`;
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function buildCsv(job: Job, options: ExportOptions = {}): string {
  const showTimestamps = options.timestamps !== false;
  const showSpeakers = options.speakers !== false;
  const columns = [
    "type",
    ...(showTimestamps ? ["start", "end"] : []),
    ...(showSpeakers ? ["speaker"] : []),
    "text",
  ];
  const rows = job.segments.map((segment) => [
    "transcript",
    ...(showTimestamps ? [segment.start, segment.start + Math.max(segment.duration, 0.4)] : []),
    ...(showSpeakers ? [segment.speaker || ""] : []),
    segment.text,
  ]);
  const summary = options.summary === false ? "" : job.summary.trim();
  if (summary)
    rows.unshift([
      "summary",
      ...(showTimestamps ? ["", ""] : []),
      ...(showSpeakers ? [""] : []),
      summary,
    ]);
  return `${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timestampQualityLabel(job: Job): string {
  const quality = job.timestampQuality ?? (job.source?.kind === "upload" ? "none" : "source");
  switch (quality) {
    case "chunk-estimated":
      return "Chunk-estimated (approximate)";
    case "provider":
      return "Provider timing";
    case "source":
      return "Source caption timing";
    case "none":
      return "No reliable timing";
  }
}

export function buildPrintHtml(
  job: Job,
  mode: TimestampMode = "off",
  options: ExportOptions = {},
): string {
  const title = escapeHtml(documentTitle(job));
  const summary = options.summary === false ? "" : job.summary.trim();
  const source = sourceLabel(job);
  const showTimestamps = options.timestamps ?? mode !== "off";
  const paragraphs = job.paragraphs
    .map((paragraph) => {
      const timestamp = showTimestamps
        ? `<span class="timestamp">[${escapeHtml(formatTimestamp(paragraph.start))}]</span> `
        : "";
      const speaker =
        options.speakers !== false && paragraph.speaker
          ? `<strong>${escapeHtml(paragraph.speaker)}:</strong> `
          : "";
      return `<p>${timestamp}${speaker}${escapeHtml(paragraph.text)}</p>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="${escapeHtml(job.language || "en")}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#111;margin:40px auto;padding:0 28px;max-width:850px}h1{font-size:28px;line-height:1.25}h2{font-size:20px;margin-top:30px}.metadata,.timestamp{color:#555;font-size:13px}p,.summary{white-space:pre-wrap;overflow-wrap:anywhere}.summary{padding:16px;background:#f4f4f4}p{break-inside:avoid}@media print{body{margin:0;padding:0;max-width:none}h1,h2{break-after:avoid}.summary{background:none;padding:0}}@page{margin:20mm}</style></head>
<body><h1>${title}</h1>
<div class="metadata">${source ? `Source: ${escapeHtml(source)}<br>` : ""}Language: ${escapeHtml(job.language)} (${escapeHtml(sourceTypeLabel(job))})<br>Provider: ${escapeHtml(job.providerLabel)}${showTimestamps ? `<br>Timestamp quality: ${escapeHtml(timestampQualityLabel(job))}` : ""}</div>
${summary ? `<h2>Summary (${escapeHtml(summaryKindLabel(job.summaryKind))})</h2><div class="summary">${escapeHtml(summary)}</div>` : ""}
<h2>Transcript</h2>${paragraphs}</body></html>`;
}

/** Cue ownership uses paragraph start ranges, so overlapping cue durations cannot claim the next turn. */
function paragraphIndexForCue(paragraphs: Paragraph[], start: number): number {
  let index = -1;
  let low = 0;
  let high = paragraphs.length - 1;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    if (paragraphs[candidate]!.start <= start) {
      index = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  return index;
}

function speakerNames(paragraphs: Paragraph[], segments: Segment[]): string[] {
  return Array.from(
    new Set(
      [...paragraphs, ...segments].flatMap((entry) => (entry.speaker ? [entry.speaker] : [])),
    ),
  );
}

export function updateParagraph(
  job: Job,
  index: number,
  patch: Partial<Pick<Paragraph, "text" | "speaker">>,
): Job {
  const original = job.paragraphs[index];
  if (!original) return job;
  const updated = {
    ...original,
    ...(typeof patch.text === "string" ? { text: patch.text } : {}),
    ...(Object.hasOwn(patch, "speaker") ? { speaker: patch.speaker?.trim() || undefined } : {}),
  };
  if (original.text === updated.text && original.speaker === updated.speaker) return job;
  const paragraphs = job.paragraphs.map((paragraph, candidate) =>
    candidate === index ? updated : paragraph,
  );
  let segments: Segment[];
  if (updated.text !== original.text) {
    const paragraphEnd = original.start + Math.max(original.duration, 0.4);
    segments = job.segments.filter(
      (segment) =>
        paragraphIndexForCue(job.paragraphs, segment.start) !== index ||
        segment.start >= paragraphEnd,
    );
    if (updated.text.trim()) {
      const replacement: Segment = {
        start: updated.start,
        duration: updated.duration,
        text: updated.text,
        ...(updated.speaker ? { speaker: updated.speaker } : {}),
      };
      const insertAt = segments.findIndex((segment) => segment.start >= replacement.start);
      segments.splice(insertAt < 0 ? segments.length : insertAt, 0, replacement);
    }
  } else {
    segments = job.segments.map((segment) =>
      paragraphIndexForCue(job.paragraphs, segment.start) === index
        ? { ...segment, speaker: updated.speaker }
        : segment,
    );
  }
  const paragraphEdits = {
    ...job.paragraphEdits,
    [String(original.start)]: { text: updated.text, speaker: updated.speaker },
  };
  return {
    ...job,
    paragraphs,
    segments,
    segmentCount: segments.length,
    speakers: speakerNames(paragraphs, segments),
    paragraphEdits,
  };
}

export function renameSpeaker(job: Job, oldName: string, newName: string): Job {
  const name = newName.trim();
  if (oldName === name) return job;
  const paragraphs = job.paragraphs.map((paragraph) =>
    paragraph.speaker === oldName ? { ...paragraph, speaker: name || undefined } : paragraph,
  );
  const paragraphEdits = { ...job.paragraphEdits };
  paragraphs.forEach((paragraph, index) => {
    if (job.paragraphs[index]!.speaker === oldName) {
      paragraphEdits[String(paragraph.start)] = {
        text: paragraph.text,
        speaker: paragraph.speaker,
      };
    }
  });
  const segments = job.segments.map((segment) => {
    const owner = paragraphIndexForCue(job.paragraphs, segment.start);
    const ownerSpeaker = job.paragraphs[owner]?.speaker;
    return ownerSpeaker === oldName || (!ownerSpeaker && segment.speaker === oldName)
      ? { ...segment, speaker: name || undefined }
      : segment;
  });
  return {
    ...job,
    paragraphs,
    segments,
    speakers: speakerNames(paragraphs, segments),
    paragraphEdits,
  };
}

export function downloadUtf8(filename: string, contents: string, mime: string, bom = false): void {
  const parts: BlobPart[] = [];
  if (bom) parts.push(new Uint8Array([0xef, 0xbb, 0xbf]));
  parts.push(contents);
  const blob = new Blob(parts, { type: `${mime};charset=utf-8` });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function formatInlineTs(seconds: number): string {
  return `[${formatTimestamp(seconds)}]`;
}
