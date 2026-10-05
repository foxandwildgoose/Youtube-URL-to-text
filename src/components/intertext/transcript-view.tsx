import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimestamp } from "@/lib/intertext/clean";
import type { Paragraph, TimestampMode } from "@/lib/intertext/types";

import { escapeRegExp } from "@/lib/intertext/search";

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
  editing = false,
  onParagraphChange,
  onSpeakerRename,
  onSeek,
}: {
  paragraphs: Paragraph[];
  mode: TimestampMode;
  query: string;
  language: string;
  editing?: boolean;
  onParagraphChange?: (index: number, patch: Partial<Pick<Paragraph, "text" | "speaker">>) => void;
  onSpeakerRename?: (previous: string, next: string) => void;
  onSeek?: (seconds: number) => void;
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
    return <p className="text-sm text-muted">No transcript text is available yet.</p>;
  }

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted">
        No paragraphs match “{q}”. Clear search to see the full transcript.
      </p>
    );
  }

  return (
    <article lang={language} className="max-w-prose space-y-5">
      {filtered.map((paragraph, index) => {
        const n = paragraphs.indexOf(paragraph) + 1;
        const prev = index > 0 ? filtered[index - 1] : undefined;
        const showSpeaker = Boolean(paragraph.speaker) && paragraph.speaker !== prev?.speaker;
        return (
          <TranscriptBlock
            key={`${paragraph.start}-${n}`}
            paragraph={paragraph}
            index={n - 1}
            mode={mode}
            query={q}
            showSpeaker={showSpeaker}
            editing={editing}
            onParagraphChange={onParagraphChange}
            onSpeakerRename={onSpeakerRename}
            onSeek={onSeek}
          />
        );
      })}
    </article>
  );
}

function TranscriptBlock({
  paragraph,
  index,
  mode,
  query,
  showSpeaker,
  editing,
  onParagraphChange,
  onSpeakerRename,
  onSeek,
}: {
  paragraph: Paragraph;
  index: number;
  mode: TimestampMode;
  query: string;
  showSpeaker: boolean;
  editing: boolean;
  onParagraphChange?: (index: number, patch: Partial<Pick<Paragraph, "text" | "speaker">>) => void;
  onSpeakerRename?: (previous: string, next: string) => void;
  onSeek?: (seconds: number) => void;
}) {
  const [speakerDraft, setSpeakerDraft] = useState(paragraph.speaker ?? "");
  useEffect(() => setSpeakerDraft(paragraph.speaker ?? ""), [paragraph.speaker]);
  const time = formatTimestamp(paragraph.start);

  return (
    <div className="transcript-block min-w-0 text-base leading-read break-words text-fg">
      {mode === "srt" ? (
        <span className="label-caps mb-1 block text-subtle tabular-nums">{index + 1}</span>
      ) : null}
      {editing && paragraph.speaker && onSpeakerRename ? (
        <label className="mb-2 block max-w-xs">
          <span className="mb-1 block text-xs text-muted">Speaker name</span>
          <Input
            value={speakerDraft}
            aria-label={`Speaker for paragraph ${index + 1}`}
            className="h-11 min-h-11 text-sm"
            onChange={(event) => setSpeakerDraft(event.target.value)}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (next && next !== paragraph.speaker) onSpeakerRename(paragraph.speaker!, next);
              else setSpeakerDraft(paragraph.speaker ?? "");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = paragraph.speaker ?? "";
                setSpeakerDraft(paragraph.speaker ?? "");
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      ) : showSpeaker ? (
        <span className="mb-1 block text-sm font-medium tracking-wide text-accent-text">
          <HighlightedText text={paragraph.speaker ?? ""} query={query} />
        </span>
      ) : null}
      {mode !== "off" ? (
        onSeek ? (
          <Button
            variant="ghost"
            className="mr-2 mb-1 min-h-11 px-2 font-mono text-xs tabular-nums text-accent-text"
            aria-label={`Seek to ${time}`}
            onClick={() => onSeek(paragraph.start)}
          >
            [{time}]
          </Button>
        ) : (
          <span className="mr-2 font-mono text-xs tabular-nums text-accent-text">[{time}]</span>
        )
      ) : null}
      {editing && onParagraphChange ? (
        <textarea
          value={paragraph.text}
          aria-label={`Transcript paragraph ${index + 1}`}
          rows={Math.min(12, Math.max(3, Math.ceil(paragraph.text.length / 90)))}
          onChange={(event) => onParagraphChange(index, { text: event.target.value })}
          className="block w-full resize-y rounded-md border border-border bg-panel px-3 py-2 text-base leading-read text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <HighlightedText text={paragraph.text} query={query} />
      )}
    </div>
  );
}
