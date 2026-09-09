import { formatTimestamp } from "@/lib/intertext/clean";
import type { Paragraph, TimestampMode } from "@/lib/intertext/types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function countMatches(text: string, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const re = new RegExp(escapeRegExp(q), "gi");
  return text.match(re)?.length ?? 0;
}

export function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const re = new RegExp(`(${escapeRegExp(q)})`, "gi");
  const parts = text.split(re);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={`${index}-${part}`} className="mark-hit">
            {part}
          </mark>
        ) : (
          <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
        ),
      )}
    </>
  );
}

export function TranscriptView({
  paragraphs,
  mode,
  query,
  language,
}: {
  paragraphs: Paragraph[];
  mode: TimestampMode;
  query: string;
  language: string;
}) {
  const q = query.trim();
  const filtered =
    q.length === 0
      ? paragraphs
      : paragraphs.filter(
          (p) =>
            p.text.toLowerCase().includes(q.toLowerCase()) ||
            (p.speaker && p.speaker.toLowerCase().includes(q.toLowerCase())),
        );

  if (paragraphs.length === 0) {
    return <p className="text-sm text-muted">No caption text in this track.</p>;
  }

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted">
        No paragraphs match “{q}”. Clear search to see the full transcript.
      </p>
    );
  }

  return (
    <article lang={language} className="space-y-5">
      {filtered.map((paragraph, index) => {
        const n = paragraphs.indexOf(paragraph) + 1;
        const prev = index > 0 ? filtered[index - 1] : undefined;
        const showSpeaker = Boolean(paragraph.speaker) && paragraph.speaker !== prev?.speaker;
        return (
          <p key={`${paragraph.start}-${index}`} className="transcript-block text-pretty text-base leading-relaxed text-fg">
            {mode === "srt" ? (
              <span className="mb-1 block font-mono text-xs tabular-nums text-subtle">{n}</span>
            ) : null}
            {showSpeaker ? (
              <span className="mb-1 block text-sm font-medium tracking-wide text-accent">
                {paragraph.speaker}
              </span>
            ) : null}
            {mode !== "off" ? (
              <span className="mr-2 font-mono text-xs tabular-nums text-accent">
                [{formatTimestamp(paragraph.start)}]
              </span>
            ) : null}
            <HighlightedText text={paragraph.text} query={q} />
          </p>
        );
      })}
    </article>
  );
}
