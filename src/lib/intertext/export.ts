import { formatSrtTime, formatTimestamp, visibleTranscript } from "./clean.ts";
import { SUMMARY_KINDS, type Job, type TimestampMode } from "./types.ts";

export function sanitizeFilename(title: string, fallback: string): string {
  const base = (title || fallback)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return base || fallback;
}

export function exportBasename(job: Job): string {
  return sanitizeFilename(job.title, job.videoId);
}

export function summaryKindLabel(kind: Job["summaryKind"]): string {
  return SUMMARY_KINDS.find((k) => k.id === kind)?.label ?? "General";
}

export function composeDocument(job: Job, mode: TimestampMode): string {
  const title = (job.title || job.videoId).trim();
  const summary = (job.summary || "").trim();
  const body = visibleTranscript(job.paragraphs, mode === "srt" ? "inline" : mode);
  const parts = [title, ""];
  if (summary) {
    parts.push(`Summary (${summaryKindLabel(job.summaryKind)})`, summary, "");
  }
  parts.push(body.trim());
  return `${parts.join("\n").trim()}\n`;
}

export function buildTxt(job: Job, mode: TimestampMode): string {
  return composeDocument(job, mode);
}

export function buildMarkdown(job: Job, mode: TimestampMode): string {
  const kind = job.sourceType === "asr" ? "Auto-generated" : "Manual";
  const body = visibleTranscript(job.paragraphs, mode === "off" ? "off" : "inline");
  const summary = (job.summary || "").trim();
  const lines = [
    `# ${job.title || job.videoId}`,
    "",
    `Source: ${job.url}`,
    `Language: ${job.language} (${kind})`,
    `Provider: ${job.providerLabel}`,
    "",
  ];
  if (summary) {
    lines.push(`## Summary (${summaryKindLabel(job.summaryKind)})`, "", summary, "");
  }
  lines.push("## Transcript", "", body, "");
  return lines.join("\n");
}

export function buildSrt(job: Job): string {
  return job.segments
    .map((seg, i) => {
      const start = formatSrtTime(seg.start);
      const end = formatSrtTime(seg.start + Math.max(seg.duration, 0.4));
      const speaker = seg.speaker ? `${seg.speaker}: ` : "";
      return `${i + 1}\n${start} --> ${end}\n${speaker}${seg.text}`;
    })
    .join("\n\n")
    .concat("\n");
}

export function buildJson(job: Job): string {
  return `${JSON.stringify(
    {
      videoId: job.videoId,
      url: job.url,
      language: job.language,
      sourceType: job.sourceType,
      title: job.title,
      provider: job.provider,
      summaryKind: job.summaryKind,
      summary: job.summary,
      segments: job.segments.map((s) => ({
        start: s.start,
        duration: s.duration,
        text: s.text,
        ...(s.speaker ? { speaker: s.speaker } : {}),
      })),
      paragraphs: job.paragraphs.map((p) => ({
        start: p.start,
        duration: p.duration,
        text: p.text,
        ...(p.speaker ? { speaker: p.speaker } : {}),
      })),
    },
    null,
    2,
  )}\n`;
}

export function downloadUtf8(
  filename: string,
  contents: string,
  mime: string,
  bom = false,
): void {
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
