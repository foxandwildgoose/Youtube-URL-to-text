import { useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Download, LoaderCircle, Pencil, Printer, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  estimatedReadMinutes,
  formatDurationClock,
  visibleTranscript,
  wordCount,
} from "@/lib/intertext/clean";
import {
  buildCsv,
  buildJson,
  buildMarkdown,
  buildPrintHtml,
  buildSrt,
  buildTxt,
  buildVtt,
  composeDocument,
  downloadUtf8,
  exportBasename,
  renameSpeaker,
  summaryKindLabel,
  updateParagraph,
  type ExportOptions,
} from "@/lib/intertext/export";
import { countMatches } from "@/lib/intertext/search";
import type { Job, TimestampMode } from "@/lib/intertext/types";
import { SegmentedControl } from "./segmented-control";
import { HighlightedText, TranscriptView } from "./transcript-view";

const TS_OPTIONS: Array<{ id: TimestampMode; label: string }> = [
  { id: "off", label: "Off" },
  { id: "inline", label: "Inline" },
  { id: "srt", label: "SRT-style" },
];

type ExportFormat = "txt" | "srt" | "vtt" | "md" | "json" | "csv" | "print";
const FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: "txt", label: "TXT" },
  { id: "srt", label: "SRT" },
  { id: "vtt", label: "VTT" },
  { id: "md", label: "Markdown" },
  { id: "json", label: "JSON" },
  { id: "csv", label: "CSV" },
  { id: "print", label: "Print / Save as PDF" },
];

export type ResultPaneProps = {
  job: Job;
  onChange?: (job: Job) => void;
  mediaUrl?: string;
  onGenerateSummary?: () => Promise<void>;
  summaryBusy?: boolean;
  mutationDisabled?: boolean;
};

export function ResultPane({
  job,
  onChange,
  mediaUrl,
  onGenerateSummary,
  summaryBusy = false,
  mutationDisabled = false,
}: ResultPaneProps) {
  const isUpload = job.source?.kind === "upload";
  const uploadSource = job.source?.kind === "upload" ? job.source : undefined;
  const [tsMode, setTsMode] = useState<TimestampMode>(isUpload ? "inline" : "off");
  const [query, setQuery] = useState("");
  const [bom, setBom] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("txt");
  const [includeTimestamps, setIncludeTimestamps] = useState(isUpload);
  const [includeSpeakers, setIncludeSpeakers] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [actionError, setActionError] = useState("");
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  const body = useMemo(() => visibleTranscript(job.paragraphs, tsMode), [job.paragraphs, tsMode]);
  const fullText = useMemo(() => composeDocument(job, tsMode), [job, tsMode]);
  const words = wordCount(body);
  const readMin = estimatedReadMinutes(body, job.language);
  const hits = query.trim() ? countMatches(fullText, query) : 0;
  const kind =
    job.sourceType === "transcription"
      ? "Transcribed"
      : job.sourceType === "asr"
        ? "Auto-generated"
        : "Manual";
  const base = exportBasename(job);
  const summaryLabel = summaryKindLabel(job.summaryKind);
  const title = job.title || uploadSource?.fileName || job.videoId || "Transcript";
  const quality = job.timestampQuality ?? (isUpload ? "none" : "source");
  const subtitleFormat = format === "srt" || format === "vtt";
  const options: ExportOptions = {
    timestamps: includeTimestamps,
    speakers: includeSpeakers,
    summary: includeSummary,
  };
  const canSeek = isUpload && Boolean(mediaUrl) && quality !== "none";

  async function copyVisible() {
    setActionError("");
    try {
      try {
        await navigator.clipboard.writeText(fullText);
      } catch {
        const area = document.createElement("textarea");
        area.value = fullText;
        area.setAttribute("readonly", "true");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        const didCopy = document.execCommand("copy");
        area.remove();
        if (!didCopy) throw new Error("Clipboard access was unavailable.");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setActionError("Couldn't copy text. You can export a TXT file instead.");
    }
  }

  function seek(seconds: number) {
    const media = mediaRef.current;
    if (!media) return;
    const end = Number.isFinite(media.duration) ? media.duration : job.durationSec;
    media.currentTime = Math.max(0, Math.min(seconds, end > 0 ? end : seconds));
  }

  async function generateSummary() {
    if (!onGenerateSummary) return;
    setSummaryError("");
    try {
      await onGenerateSummary();
    } catch {
      setSummaryError("The summary couldn't be generated. Your transcript is still ready to use.");
    }
  }

  function printTranscript() {
    const frame = document.createElement("iframe");
    frame.title = "Printable transcript";
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";
    let cleanupTimer: number | undefined;
    const cleanup = () => {
      if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
      frame.remove();
    };
    frame.onload = () => {
      const printable = frame.contentWindow;
      if (!printable) {
        cleanup();
        return;
      }
      printable.addEventListener("afterprint", cleanup, { once: true });
      cleanupTimer = window.setTimeout(cleanup, 60_000);
      try {
        printable.focus();
        printable.print();
      } catch {
        cleanup();
        setActionError("Printing couldn't be opened. You can export TXT or Markdown instead.");
      }
    };
    frame.srcdoc = buildPrintHtml(job, tsMode, options);
    document.body.appendChild(frame);
  }

  function exportTranscript() {
    setActionError("");
    try {
      if (format === "print") printTranscript();
      else if (format === "txt")
        downloadUtf8(`${base}.txt`, buildTxt(job, tsMode, options), "text/plain", bom);
      else if (format === "srt")
        downloadUtf8(`${base}.srt`, buildSrt(job, options), "application/x-subrip");
      else if (format === "vtt") downloadUtf8(`${base}.vtt`, buildVtt(job, options), "text/vtt");
      else if (format === "md")
        downloadUtf8(`${base}.md`, buildMarkdown(job, tsMode, options), "text/markdown");
      else if (format === "csv")
        downloadUtf8(`${base}.csv`, buildCsv(job, options), "text/csv", bom);
      else downloadUtf8(`${base}.json`, buildJson(job, options), "application/json");
      setExportOpen(false);
    } catch {
      setActionError("The export couldn't be created. Please try again.");
    }
  }

  return (
    <section
      aria-label="Transcript result"
      className="theme-surface rounded-xl border border-border bg-panel p-4 sm:p-6"
    >
      <div className="space-y-3">
        <h2 className="font-serif text-2xl leading-snug tracking-tight break-words text-fg sm:text-3xl">
          <HighlightedText text={title} query={query} />
        </h2>
        {uploadSource ? (
          <p className="text-sm break-all text-muted">Uploaded file · {uploadSource.fileName}</p>
        ) : job.url ? (
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block break-all text-sm text-muted underline-offset-4 hover:text-accent-text hover:underline"
          >
            {job.url}
          </a>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Badge tone="accent">{job.language}</Badge>
          <Badge tone={job.sourceType === "manual" ? "ok" : "neutral"}>{kind}</Badge>
          {job.summary ? <Badge tone="accent">{summaryLabel}</Badge> : null}
          <Badge>{job.segmentCount} segments</Badge>
          <Badge>{formatDurationClock(job.durationSec)}</Badge>
          <Badge>via {job.providerLabel}</Badge>
          {isUpload ? (
            <Badge>{quality === "none" ? "No reliable timestamps" : `${quality} timestamps`}</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          <span className="tabular-nums">{words.toLocaleString()}</span> words · about{" "}
          <span className="tabular-nums">{readMin}</span> min read
        </p>
      </div>

      {isUpload ? (
        <section aria-label="Source media playback" className="mt-5 space-y-2">
          {mediaUrl && uploadSource ? (
            uploadSource.mimeType.startsWith("audio/") ? (
              <audio
                ref={(media) => {
                  mediaRef.current = media;
                }}
                src={mediaUrl}
                controls
                preload="metadata"
                aria-label="Uploaded audio playback"
                className="w-full"
              />
            ) : (
              <video
                ref={(media) => {
                  mediaRef.current = media;
                }}
                src={mediaUrl}
                controls
                preload="metadata"
                playsInline
                aria-label="Uploaded video playback"
                className="max-h-96 w-full rounded-md bg-panel-2"
              />
            )
          ) : (
            <p className="text-sm text-muted">
              Reselect the original file to enable local playback.
            </p>
          )}
          {mediaUrl ? (
            <p className="text-xs text-subtle">
              Playback stays on this device.
              {canSeek ? " Choose a transcript timestamp to seek." : ""}
            </p>
          ) : null}
          {quality === "chunk-estimated" ? (
            <p className="text-xs text-muted">
              Timestamps are chunk-estimated. They mark approximate chunk boundaries, not individual
              words.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-6 space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, summary, and transcript"
            aria-label="Search transcript"
            className="h-11 min-h-11 pr-11 pl-10"
          />
          {query ? (
            <Button
              variant="ghost"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-0 size-11 -translate-y-1/2 px-0"
              aria-label="Clear search"
            >
              <X />
            </Button>
          ) : null}
        </div>
        {query.trim() ? (
          <p className="text-xs tabular-nums text-muted">
            {hits} {hits === 1 ? "match" : "matches"}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="label-caps text-subtle">Timestamps</p>
          <SegmentedControl
            aria-label="Timestamp mode"
            value={tsMode}
            onChange={(mode) => {
              setTsMode(mode);
              setIncludeTimestamps(mode !== "off");
            }}
            className="w-full sm:w-auto"
            itemClassName="whitespace-nowrap sm:flex-none"
            options={TS_OPTIONS}
          />
        </div>
      </div>

      {job.summary ? (
        <section aria-label="Summary" className="mt-6 border-t border-border pt-5">
          <p className="label-caps text-subtle">Summary · {summaryLabel}</p>
          <div className="mt-3 max-w-prose text-base leading-read whitespace-pre-wrap break-words text-fg">
            <HighlightedText text={job.summary} query={query} />
          </div>
        </section>
      ) : null}
      {isUpload && onGenerateSummary ? (
        <div className="mt-5 space-y-2">
          <Button
            variant="secondary"
            disabled={summaryBusy || mutationDisabled || job.paragraphs.length === 0}
            onClick={() => void generateSummary()}
          >
            {summaryBusy ? <LoaderCircle className="animate-spin" /> : null}
            {summaryBusy
              ? "Generating summary…"
              : job.summary
                ? "Regenerate Summary"
                : "Generate Summary"}
          </Button>
          <p className="text-xs text-subtle">
            Optional · your transcript is ready without a summary.
          </p>
          {summaryError ? (
            <p role="alert" className="text-sm text-danger">
              {summaryError}
            </p>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Transcript" className="mt-6 border-t border-border pt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="label-caps text-subtle">Transcript</p>
          {onChange ? (
            <Button
              variant="ghost"
              disabled={mutationDisabled}
              onClick={() => setEditing((value) => !value)}
              aria-pressed={editing}
            >
              <Pencil />
              {editing ? "Done editing" : "Edit transcript"}
            </Button>
          ) : null}
        </div>
        {editing ? (
          <p className="mb-4 text-xs text-muted">
            Changes save automatically. Renaming a speaker updates every matching label.
          </p>
        ) : null}
        <TranscriptView
          paragraphs={job.paragraphs}
          mode={tsMode}
          query={query}
          language={job.language}
          editing={editing && !mutationDisabled}
          onParagraphChange={
            onChange && !mutationDisabled
              ? (index, patch) => onChange(updateParagraph(job, index, patch))
              : undefined
          }
          onSpeakerRename={
            onChange && !mutationDisabled
              ? (previous, next) => onChange(renameSpeaker(job, previous, next))
              : undefined
          }
          onSeek={canSeek ? seek : undefined}
        />
      </section>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copyVisible()} variant="ghost">
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy text"}
          </Button>
          <Dialog.Root open={exportOpen} onOpenChange={setExportOpen}>
            <Dialog.Trigger asChild>
              <Button variant="secondary">
                <Download />
                Export transcript
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-fg/25" />
              <Dialog.Content className="theme-surface fixed inset-4 z-50 m-auto h-fit max-h-full max-w-lg overflow-y-auto rounded-xl border border-border bg-panel p-5 text-fg shadow-lg sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <Dialog.Title className="font-serif text-2xl tracking-tight">
                    Export transcript
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <Button
                      variant="ghost"
                      className="size-11 shrink-0 px-0"
                      aria-label="Close export dialog"
                    >
                      <X />
                    </Button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="mt-1 text-sm text-muted">
                  Export your latest saved text and speaker edits.
                </Dialog.Description>
                <fieldset className="mt-5">
                  <legend className="mb-2 text-sm font-medium text-muted">Format</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {FORMATS.map((item) => (
                      <label
                        key={item.id}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${format === item.id ? "border-accent bg-panel-2 text-fg" : "border-border text-muted"} ${item.id === "print" ? "col-span-2" : ""}`}
                      >
                        <input
                          type="radio"
                          name="export-format"
                          value={item.id}
                          checked={format === item.id}
                          onChange={() => setFormat(item.id)}
                          className="size-4 accent-accent"
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="mt-5">
                  <legend className="text-sm font-medium text-muted">Include</legend>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={subtitleFormat || includeTimestamps}
                      disabled={subtitleFormat}
                      onChange={(event) => setIncludeTimestamps(event.target.checked)}
                      className="size-4 accent-accent"
                    />
                    Timestamps
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={includeSpeakers}
                      onChange={(event) => setIncludeSpeakers(event.target.checked)}
                      className="size-4 accent-accent"
                    />
                    Speaker names
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={!subtitleFormat && Boolean(job.summary) && includeSummary}
                      disabled={subtitleFormat || !job.summary}
                      onChange={(event) => setIncludeSummary(event.target.checked)}
                      className="size-4 accent-accent"
                    />
                    Summary
                  </label>
                </fieldset>
                {subtitleFormat ? (
                  <p className="text-xs text-subtle">
                    Subtitle formats require timestamps and contain transcript text only.
                  </p>
                ) : null}
                {subtitleFormat && quality === "chunk-estimated" ? (
                  <p className="mt-2 text-xs text-muted">
                    Subtitle timing is chunk-estimated; cue boundaries are approximate.
                  </p>
                ) : null}
                {format === "txt" || format === "csv" ? (
                  <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={bom}
                      onChange={(event) => setBom(event.target.checked)}
                      className="size-4 accent-accent"
                    />
                    Windows-friendly UTF-8 BOM
                  </label>
                ) : null}
                <Button onClick={exportTranscript} className="mt-5 w-full">
                  {format === "print" ? <Printer /> : <Download />}
                  {format === "print" ? "Print / Save as PDF" : "Export"}
                </Button>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
        {actionError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {actionError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
