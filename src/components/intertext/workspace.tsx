import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractCaptions } from "@/lib/intertext/client-extract";
import { extractTranscript } from "@/lib/intertext/extract";
import { parseYouTubeInput } from "@/lib/intertext/parse-url";
import { attachSpeakersToSegments, applySpeakerNames, labelInterviewByRole, speakersFromSummary } from "@/lib/intertext/speakers";
import { loadJobs, upsertJob } from "@/lib/intertext/storage";
import { fallbackSummary, paragraphPayload, summarizeTranscript } from "@/lib/intertext/summarize";
import {
  SUMMARY_KINDS,
  type ExtractError,
  type Job,
  type LangMode,
  type SummaryKind,
} from "@/lib/intertext/types";
import { EmptyState } from "./empty-state";
import { ResultPane } from "./result-pane";

const LANGS: Array<{ id: LangMode; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "ko", label: "Korean" },
  { id: "en", label: "English" },
];

type Status = "idle" | "extracting" | "ready" | "error";

function loadingCopy(lang: LangMode, stage: "captions" | "turns" | "summary", kind: SummaryKind): string {
  if (stage === "turns") return "Breaking speaker turns and pauses…";
  if (stage === "summary") {
    const label = SUMMARY_KINDS.find((k) => k.id === kind)?.label ?? "General";
    return `Writing ${label.toLowerCase()} summary…`;
  }
  if (lang === "ko") return "Finding Korean captions…";
  if (lang === "en") return "Finding English captions…";
  return "Finding Korean/English captions…";
}

function languageName(code: string): string {
  const c = code.toLowerCase();
  if (c === "ko" || c.startsWith("ko-")) return "Korean";
  if (c === "en" || c.startsWith("en-")) return "English";
  return code;
}

function relativeTime(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const min = Math.round(delta / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function finishJob(
  job: Job,
  kind: SummaryKind,
  summary: string,
  speakers: string[],
  turns: Array<{ i: number; speaker: string }>,
  source: "model" | "fallback" = "fallback",
): Job {
  const names = speakers.length > 0 ? speakers : speakersFromSummary(summary);
  let paragraphs = job.paragraphs;
  if (kind === "interview" || kind === "podcast") {
    paragraphs = turns.length > 0
      ? applySpeakerNames(job.paragraphs, names, turns)
      : labelInterviewByRole(job.paragraphs, names);
  } else {
    paragraphs = applySpeakerNames(job.paragraphs, names);
  }
  return {
    ...job,
    paragraphs,
    segments: attachSpeakersToSegments(job.segments, paragraphs),
    summaryKind: kind,
    summary,
    speakers: names,
    summarySource: source,
  };
}

export function Workspace() {
  const extractOnServer = useServerFn(extractTranscript);
  const summarizeOnServer = useServerFn(summarizeTranscript);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<LangMode>("auto");
  const [summaryKind, setSummaryKind] = useState<SummaryKind>("interview");
  const [status, setStatus] = useState<Status>("idle");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<ExtractError | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [progress, setProgress] = useState("Finding Korean/English captions…");
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setJobs(loadJobs());
  }, []);

  useEffect(() => {
    if (status !== "ready" || !job) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }, [status, job]);

  const statusLabel = useMemo(() => {
    if (status === "extracting") return progress;
    if (status === "ready" && job) {
      return `Ready · ${job.providerLabel} · ${job.segmentCount} segments`;
    }
    if (status === "error" && error) {
      const labels: Record<string, string> = {
        invalid_url: "Error · invalid URL",
        no_captions: "Error · no public captions",
        age_restricted: "Error · age-restricted",
        members_only: "Error · members-only",
        provider_blocked: "Error · provider blocked",
        network: "Error · network",
        language_missing: "Error · language not on this video",
        unavailable: "Error · video unavailable",
      };
      return labels[error.code] ?? "Error · extraction failed";
    }
    return "Paste a public YouTube URL and choose a summary type.";
  }, [status, progress, job, error]);

  async function runExtract(raw: string, requested: LangMode, kind: SummaryKind) {
    const parsed = parseYouTubeInput(raw);
    if (!parsed.ok) {
      setJob(null);
      setError({ code: "invalid_url", message: parsed.message });
      setStatus("error");
      return;
    }

    setStatus("extracting");
    setError(null);
    setProgress(loadingCopy(requested, "captions", kind));
    const turnTimer = window.setTimeout(() => {
      setProgress(loadingCopy(requested, "turns", kind));
    }, 1400);

    try {
      const result = await extractCaptions(parsed.video.videoId, requested, extractOnServer);
      if (!result.ok) {
        setJob(null);
        setError(result.error);
        setStatus("error");
        return;
      }

      window.clearTimeout(turnTimer);
      setProgress(loadingCopy(requested, "summary", kind));

      let summary = "";
      let speakers: string[] = [];
      let turns: Array<{ i: number; speaker: string }> = [];
      let source: "model" | "fallback" = "fallback";
      try {
        const summed = await summarizeOnServer({
          data: {
            title: result.job.title,
            language: result.job.language,
            kind,
            paragraphs: paragraphPayload(result.job.paragraphs),
          },
        });
        summary = summed.summary;
        speakers = summed.speakers ?? [];
        turns = summed.turns ?? [];
        source = summed.source === "model" ? "model" : "fallback";
      } catch {
        summary = fallbackSummary(result.job.title, kind, result.job.paragraphs);
        source = "fallback";
      }

      const next = finishJob(result.job, kind, summary, speakers, turns, source);
      setJob(next);
      setStatus("ready");
      setJobs((prev) => upsertJob(prev, next));
    } finally {
      window.clearTimeout(turnTimer);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void runExtract(input, lang, summaryKind);
  }

  function reopen(next: Job) {
    setInput(next.url);
    setLang(next.requestedLang);
    setSummaryKind(next.summaryKind || "interview");
    setJob(next);
    setError(null);
    setStatus("ready");
  }

  const showEmpty = status === "idle" && !job;
  const showResult = job && status !== "extracting";
  const busy = status === "extracting";

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6 sm:px-6">
          <p className="font-serif text-3xl tracking-tight italic sm:text-4xl">INTERTEXT</p>
          <p className="max-w-xl text-sm text-muted">
            Public YouTube talks as readable text — title, summary, then transcript.
          </p>
        </div>
        <div className="h-px bg-accent" />
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="yt-url" className="text-sm font-medium text-muted">
              YouTube URL or video ID
            </label>
            <Input
              id="yt-url"
              name="url"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=… or 11-character ID"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              enterKeyHint="go"
              disabled={busy}
              aria-invalid={status === "error" && error?.code === "invalid_url"}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted">Caption language</p>
            <div
              role="radiogroup"
              aria-label="Caption language"
              className="flex min-h-12 rounded-md bg-panel p-1"
            >
              {LANGS.map((opt) => {
                const on = lang === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => setLang(opt.id)}
                    className={
                      on
                        ? "h-10 min-h-10 flex-1 rounded-sm bg-bg text-sm text-fg"
                        : "h-10 min-h-10 flex-1 rounded-sm text-sm text-muted hover:text-fg"
                    }
                  >
                    {opt.label}
                    {opt.id !== "auto" ? (
                      <span className="ml-1 text-xs text-subtle">({opt.id})</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted">Summary type</p>
            <div
              role="radiogroup"
              aria-label="Summary type"
              className="grid grid-cols-3 gap-1 rounded-md bg-panel p-1 sm:grid-cols-5"
            >
              {SUMMARY_KINDS.map((opt) => {
                const on = summaryKind === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`${opt.label}. ${opt.hint}`}
                    disabled={busy}
                    onClick={() => setSummaryKind(opt.id)}
                    className={
                      on
                        ? "h-11 min-h-11 rounded-sm bg-bg px-2 text-sm text-fg"
                        : "h-11 min-h-11 rounded-sm px-2 text-sm text-muted hover:text-fg"
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-subtle">
              {SUMMARY_KINDS.find((k) => k.id === summaryKind)?.hint}
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full sm:w-48" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="animate-spin" />
                Extract
              </>
            ) : (
              "Extract"
            )}
          </Button>
        </form>

        <p
          role="status"
          aria-live="polite"
          className={
            status === "error"
              ? "text-sm text-danger"
              : status === "ready"
                ? "text-sm text-ok"
                : "text-sm text-muted"
          }
        >
          {statusLabel}
        </p>

        {busy ? (
          <div className="rounded-xl border border-border bg-panel px-5 py-8">
            <p className="flex items-center gap-3 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin text-accent" />
              {progress}
            </p>
            <p className="mt-2 text-sm text-subtle">
              Public caption tracks only — the video is not downloaded. Summary is written after
              the transcript is cleaned.
            </p>
          </div>
        ) : null}

        {status === "error" && error ? (
          <div className="rounded-xl border border-border bg-panel p-5">
            <p className="flex items-start gap-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error.message}</span>
            </p>
            {error.details ? (
              <p className="mt-2 font-mono text-xs break-words text-subtle">{error.details}</p>
            ) : null}
            {error.code === "language_missing" && error.fallbackLang ? (
              <Button
                className="mt-4"
                variant="secondary"
                onClick={() => {
                  const next = error.fallbackLang?.toLowerCase().startsWith("ko")
                    ? "ko"
                    : error.fallbackLang?.toLowerCase().startsWith("en")
                      ? "en"
                      : "auto";
                  setLang(next);
                  void runExtract(input, next, summaryKind);
                }}
              >
                Extract {languageName(error.fallbackLang)} instead
              </Button>
            ) : null}
            {error.code === "no_captions" || error.code === "provider_blocked" ? (
              <p className="mt-3 text-sm text-muted">
                On YouTube: More → Show transcript → copy. Locally:{" "}
                <code className="font-mono text-xs text-fg">yt-dlp --write-subs --skip-download URL</code>
              </p>
            ) : null}
          </div>
        ) : null}

        {showEmpty ? <EmptyState onPick={setInput} /> : null}

        {showResult && job ? (
          <div ref={resultRef}>
            <ResultPane key={`${job.videoId}-${job.language}-${job.createdAt}-${job.summaryKind}`} job={job} />
          </div>
        ) : null}

        {jobs.length > 0 ? (
          <section aria-label="Recent jobs">
            <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">Recent</h2>
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
              {jobs.map((item) => (
                <li key={`${item.videoId}-${item.language}-${item.createdAt}`}>
                  <button
                    type="button"
                    onClick={() => reopen(item)}
                    className="flex min-h-14 w-full flex-col gap-1 px-4 py-3 text-left hover:bg-panel-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">{item.title || item.videoId}</span>
                      <span className="block font-mono text-xs text-subtle">
                        {item.videoId} · {item.language}
                        {item.summaryKind ? ` · ${item.summaryKind}` : ""}
                      </span>
                    </span>
                    <span className="text-xs tabular-nums text-subtle">{relativeTime(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
        <p className="text-xs leading-relaxed text-subtle">
          Personal research use only; do not republish copyrighted interviews; this app reads
          public captions, it does not download the video.
        </p>
      </footer>
    </div>
  );
}
