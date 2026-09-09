import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileJson,
  FileText,
  Search,
  X,
} from "lucide-react";
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
  buildJson,
  buildMarkdown,
  buildSrt,
  buildTxt,
  composeDocument,
  downloadUtf8,
  exportBasename,
  summaryKindLabel,
} from "@/lib/intertext/export";
import type { Job, TimestampMode } from "@/lib/intertext/types";
import { SegmentedControl } from "./segmented-control";
import { countMatches, HighlightedText, TranscriptView } from "./transcript-view";

const TS_OPTIONS: Array<{ id: TimestampMode; label: string }> = [
  { id: "off", label: "Off" },
  { id: "inline", label: "Inline" },
  { id: "srt", label: "SRT-style" },
];

export function ResultPane({ job }: { job: Job }) {
  const [tsMode, setTsMode] = useState<TimestampMode>("off");
  const [query, setQuery] = useState("");
  const [bom, setBom] = useState(true);
  const [copied, setCopied] = useState(false);

  const body = useMemo(
    () => visibleTranscript(job.paragraphs, tsMode),
    [job.paragraphs, tsMode],
  );
  const fullText = useMemo(() => composeDocument(job, tsMode), [job, tsMode]);
  const words = wordCount(body);
  const readMin = estimatedReadMinutes(body, job.language);
  const hits = query.trim() ? countMatches(fullText, query) : 0;
  const kind = job.sourceType === "asr" ? "Auto-generated" : "Manual";
  const base = exportBasename(job);
  const summaryLabel = summaryKindLabel(job.summaryKind);

  async function copyVisible() {
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
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function download(kindName: "txt" | "srt" | "md" | "json") {
    if (kindName === "txt") {
      downloadUtf8(`${base}.txt`, buildTxt(job, tsMode), "text/plain", bom);
      return;
    }
    if (kindName === "srt") {
      downloadUtf8(`${base}.srt`, buildSrt(job), "application/x-subrip", false);
      return;
    }
    if (kindName === "md") {
      downloadUtf8(`${base}.md`, buildMarkdown(job, tsMode), "text/markdown", false);
      return;
    }
    downloadUtf8(`${base}.json`, buildJson(job), "application/json", false);
  }

  return (
    <section
      aria-label="Transcript result"
      className="theme-surface rounded-xl border border-border bg-panel p-4 sm:p-6"
    >
      <div className="space-y-3">
        <h2 className="font-serif text-2xl leading-snug tracking-tight text-fg sm:text-3xl">
          {job.title || job.videoId}
        </h2>
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="inline-block break-all text-sm text-muted underline-offset-4 hover:text-accent-text hover:underline"
        >
          {job.url}
        </a>
        <div className="flex flex-wrap gap-2">
          <Badge tone="accent">{job.language}</Badge>
          <Badge tone={job.sourceType === "manual" ? "ok" : "neutral"}>{kind}</Badge>
          <Badge tone="accent">{summaryLabel}</Badge>
          <Badge>{job.segmentCount} segments</Badge>
          <Badge>{formatDurationClock(job.durationSec)}</Badge>
          <Badge>via {job.providerLabel}</Badge>
        </div>
        <p className="text-sm text-muted">
          <span className="tabular-nums">{words.toLocaleString()}</span> words · about{" "}
          <span className="tabular-nums">{readMin}</span> min read
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, summary, and transcript"
            aria-label="Search transcript"
            className="h-11 min-h-11 pr-11 pl-10"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
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
            onChange={setTsMode}
            className="w-full sm:w-auto"
            itemClassName="sm:flex-none"
            options={TS_OPTIONS}
          />
        </div>
      </div>

      {job.summary ? (
        <section aria-label="Summary" className="mt-6 border-t border-border pt-5">
          <p className="label-caps text-subtle">Summary · {summaryLabel}</p>
          <div className="mt-3 max-w-prose whitespace-pre-wrap text-base leading-read text-fg">
            <HighlightedText text={job.summary} query={query} />
          </div>
        </section>
      ) : null}

      <section aria-label="Transcript" className="mt-6 border-t border-border pt-5">
        <p className="label-caps mb-4 text-subtle">Transcript</p>
        <TranscriptView
          paragraphs={job.paragraphs}
          mode={tsMode}
          query={query}
          language={job.language}
        />
      </section>

      <div className="mt-6 border-t border-border pt-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Button onClick={copyVisible} variant="ghost" className="col-span-2 sm:col-span-1">
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy text"}
          </Button>
          <Button onClick={() => download("txt")} variant="ghost">
            <FileText />
            TXT
          </Button>
          <Button onClick={() => download("srt")} variant="ghost">
            <Download />
            SRT
          </Button>
          <Button onClick={() => download("md")} variant="ghost">
            <FileText />
            Markdown
          </Button>
          <Button onClick={() => download("json")} variant="ghost">
            <FileJson />
            JSON
          </Button>
        </div>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={bom}
            onChange={(e) => setBom(e.target.checked)}
            className="size-4 accent-accent"
          />
          Windows-friendly TXT (UTF-8 BOM)
        </label>
      </div>
    </section>
  );
}
