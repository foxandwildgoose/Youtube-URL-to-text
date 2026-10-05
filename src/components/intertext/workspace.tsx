import { useEffect, useMemo, useRef, useState, lazy, Suspense, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractCaptions } from "@/lib/intertext/client-extract";
import { extractTranscript } from "@/lib/intertext/extract";
import { parseYouTubeInput } from "@/lib/intertext/parse-url";
import {
  attachSpeakersToSegments,
  applySpeakerNames,
  labelInterviewByRole,
  speakersFromSummary,
} from "@/lib/intertext/speakers";
import {
  loadJobs,
  upsertJob,
  saveJob,
  deleteJob,
  jobIdentity,
  exportBackup,
  importBackup,
} from "@/lib/intertext/storage";
import { fallbackSummary, paragraphPayload, summarizeTranscript } from "@/lib/intertext/summarize";
import {
  SUMMARY_KINDS,
  type ExtractError,
  type Job,
  type LangMode,
  type SummaryKind,
} from "@/lib/intertext/types";
import { EmptyState } from "./empty-state";
import { ExtractSkeleton } from "./extract-skeleton";
import { ResultPane } from "./result-pane";
import { SegmentedControl } from "./segmented-control";
import { ThemeToggle } from "./theme-toggle";

const UploadWorkspace = lazy(() =>
  import("./upload-workspace").then((module) => ({ default: module.UploadWorkspace })),
);

const LANGS: Array<{ id: LangMode; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "ko", label: "Korean" },
  { id: "en", label: "English" },
];

type Status = "idle" | "extracting" | "ready" | "error";

function loadingCopy(
  lang: LangMode,
  stage: "captions" | "turns" | "summary",
  kind: SummaryKind,
): string {
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
    paragraphs =
      turns.length > 0
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
  const [sourceMode, setSourceMode] = useState<"youtube" | "upload">("youtube");
  const [uploadMounted, setUploadMounted] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | undefined>();
  const [historyQuery, setHistoryQuery] = useState("");
  const [storageError, setStorageError] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<LangMode>("auto");
  const [summaryKind, setSummaryKind] = useState<SummaryKind>("interview");
  const [status, setStatus] = useState<Status>("idle");
  const [job, setJob] = useState<Job | null>(null);
  const currentJob = useRef<Job | null>(job);
  currentJob.current = job;
  const summaryLock = useRef(false);
  const displayedJobId = job ? jobIdentity(job) : undefined;
  const [error, setError] = useState<ExtractError | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [progress, setProgress] = useState("Finding Korean/English captions…");
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadJobs()
      .then(setJobs)
      .catch((error) =>
        setStorageError(error instanceof Error ? error.message : "History could not be loaded."),
      );
  }, []);

  useEffect(() => {
    if (status !== "ready" || !displayedJobId) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }, [status, displayedJobId]);

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
      await persistJob(next);
    } finally {
      window.clearTimeout(turnTimer);
    }
  }

  async function persistJob(next: Job) {
    currentJob.current = next;
    setJob(next);
    setJobs((prev) => upsertJob(prev, next));
    try {
      await saveJob(next);
      setStorageError("");
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? error.message
          : "History could not be saved. Export a backup before closing this tab.",
      );
      throw error;
    }
  }

  async function generateSummary() {
    const selected = currentJob.current;
    if (!selected || summaryLock.current || uploadBusy) return;
    const selectedId = jobIdentity(selected);
    summaryLock.current = true;
    setSummaryBusy(true);
    try {
      const summed = await summarizeOnServer({
        data: {
          title: selected.title,
          language: selected.language,
          kind: selected.summaryKind,
          paragraphs: paragraphPayload(selected.paragraphs),
        },
      });
      const latest = currentJob.current;
      if (latest && jobIdentity(latest) === selectedId)
        await persistJob({ ...latest, summary: summed.summary, summarySource: summed.source });
    } finally {
      summaryLock.current = false;
      setSummaryBusy(false);
    }
  }

  async function downloadBackup() {
    try {
      const { downloadUtf8 } = await import("@/lib/intertext/export");
      downloadUtf8("intertext-backup.json", await exportBackup(), "application/json");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Backup export failed.");
    }
  }

  async function restoreBackup(file: File) {
    try {
      await importBackup(await file.text());
      setJobs(await loadJobs());
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Backup import failed.");
    }
  }

  async function removeJob(item: Job) {
    try {
      await deleteJob(jobIdentity(item));
      setJobs((prev) => prev.filter((value) => jobIdentity(value) !== jobIdentity(item)));
      if (currentJob.current && jobIdentity(currentJob.current) === jobIdentity(item)) {
        currentJob.current = null;
        setJob(null);
      }
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not delete this job.");
    }
  }

  async function renameJob(item: Job) {
    const name = window.prompt("Recording title", item.title);
    if (name === null || !name.trim()) return;
    const next = { ...item, title: name.trim().slice(0, 300) };
    try {
      await saveJob(next);
      setJobs((prev) => upsertJob(prev, next));
      if (currentJob.current && jobIdentity(currentJob.current) === jobIdentity(item)) {
        currentJob.current = next;
        setJob(next);
      }
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not rename this job.");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void runExtract(input, lang, summaryKind).catch((error) =>
      setStorageError(
        error instanceof Error ? error.message : "The transcript could not be saved.",
      ),
    );
  }

  function reopen(next: Job) {
    setMediaUrl(undefined);
    const mode = next.source?.kind === "upload" ? "upload" : "youtube";
    setSourceMode(mode);
    if (mode === "upload") setUploadMounted(true);
    setInput(next.url ?? "");
    setLang(next.requestedLang);
    setSummaryKind(next.summaryKind || "interview");
    currentJob.current = next;
    setJob(next);
    setError(null);
    setStatus("ready");
  }

  const showEmpty = sourceMode === "youtube" && status === "idle" && !job;
  const showResult = job && job.paragraphs.length > 0 && status !== "extracting";
  const busy = status === "extracting" || uploadBusy || summaryBusy;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="theme-surface sticky top-0 z-30 bg-bg pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="font-serif text-2xl tracking-tight italic sm:text-3xl">INTERTEXT</p>
            <p className="truncate text-xs text-muted sm:text-sm">
              Audio, video & YouTube → readable text.
            </p>
          </div>
          <ThemeToggle />
        </div>
        <div className="header-rule" />
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div role="tablist" aria-label="Media source" className="seg-track">
          {(["youtube", "upload"] as const).map((mode) => (
            <button
              key={mode}
              role="tab"
              type="button"
              id={`source-${mode}`}
              aria-controls={`panel-${mode}`}
              aria-selected={sourceMode === mode}
              tabIndex={sourceMode === mode ? 0 : -1}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "youtube"
                    : event.key === "End"
                      ? "upload"
                      : mode === "youtube"
                        ? "upload"
                        : "youtube";
                setSourceMode(next);
                if (next === "upload") setUploadMounted(true);
                document.getElementById(`source-${next}`)?.focus();
              }}
              disabled={busy}
              onClick={() => {
                setSourceMode(mode);
                if (mode === "upload") setUploadMounted(true);
              }}
              className={`seg-item ${sourceMode === mode ? "seg-item-on" : ""}`}
            >
              {mode === "youtube" ? "YouTube URL" : "Upload File"}
            </button>
          ))}
        </div>
        <div
          id="panel-youtube"
          role="tabpanel"
          aria-labelledby="source-youtube"
          hidden={sourceMode !== "youtube"}
        >
          <form
            onSubmit={onSubmit}
            className="theme-surface space-y-5 rounded-xl border border-border bg-panel p-5 shadow-[var(--it-shadow-card)] sm:p-6"
          >
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
              <SegmentedControl
                aria-label="Caption language"
                value={lang}
                disabled={busy}
                onChange={setLang}
                options={LANGS.map((opt) => ({
                  id: opt.id,
                  label:
                    opt.id === "auto" ? (
                      opt.label
                    ) : (
                      <>
                        {opt.label}
                        <span className="ml-1 text-xs text-subtle">({opt.id})</span>
                      </>
                    ),
                }))}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-muted">Summary type</p>
              <SegmentedControl
                aria-label="Summary type"
                value={summaryKind}
                disabled={busy}
                className="seg-grid"
                onChange={setSummaryKind}
                options={SUMMARY_KINDS.map((opt) => ({
                  id: opt.id,
                  label: opt.label,
                  ariaLabel: `${opt.label}. ${opt.hint}`,
                }))}
              />
              <p className="text-xs text-subtle">
                {SUMMARY_KINDS.find((k) => k.id === summaryKind)?.hint}
              </p>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto sm:min-w-44"
              disabled={busy}
            >
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
        </div>
        {uploadMounted ? (
          <div
            id="panel-upload"
            role="tabpanel"
            aria-labelledby="source-upload"
            hidden={sourceMode !== "upload"}
          >
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted">
                  Preparing upload workspace…
                </p>
              }
            >
              <UploadWorkspace
                job={job}
                onJob={(next) => {
                  currentJob.current = next;
                  setJob(next);
                  if (next.upload?.status === "completed") setStatus("ready");
                }}
                onPersist={persistJob}
                onMedia={setMediaUrl}
                onBusy={setUploadBusy}
                externalDisabled={summaryBusy}
                onNew={() => {
                  currentJob.current = null;
                  setJob(null);
                  setStatus("idle");
                }}
              />
            </Suspense>
          </div>
        ) : null}

        {sourceMode === "youtube" ? (
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
        ) : null}

        {busy ? <ExtractSkeleton progress={progress} /> : null}

        {status === "error" && error ? (
          <div className="theme-surface rounded-xl border border-border bg-panel p-5">
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
                <code className="font-mono text-xs text-fg">
                  yt-dlp --write-subs --skip-download URL
                </code>
              </p>
            ) : null}
          </div>
        ) : null}

        {showEmpty ? <EmptyState onPick={setInput} /> : null}

        {showResult && job ? (
          <div ref={resultRef} className="result-enter scroll-mt-28">
            <ResultPane
              key={jobIdentity(job)}
              job={job}
              mediaUrl={job.source?.kind === "upload" ? mediaUrl : undefined}
              onChange={(next) => {
                void persistJob(next).catch(() => {});
              }}
              onGenerateSummary={generateSummary}
              summaryBusy={summaryBusy}
              mutationDisabled={uploadBusy || summaryBusy}
            />
          </div>
        ) : null}

        <section aria-label="Job history" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="label-caps text-subtle">History · this browser</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => void downloadBackup()}>
                Export INTERTEXT Backup
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => backupInput.current?.click()}>
                Import INTERTEXT Backup
              </Button>
              <input
                ref={backupInput}
                className="sr-only"
                type="file"
                accept="application/json,.json"
                aria-label="Import backup file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void restoreBackup(file);
                  event.target.value = "";
                }}
              />
            </div>
          </div>
          <Input
            aria-label="Search history"
            placeholder="Search recordings and transcripts"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
          />
          {storageError ? (
            <p role="alert" className="text-sm text-danger">
              {storageError}
            </p>
          ) : null}
          <ul className="theme-surface divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
            {jobs
              .filter((item) =>
                `${item.title} ${item.paragraphs.map((p) => p.text).join(" ")}`
                  .toLowerCase()
                  .includes(historyQuery.toLowerCase()),
              )
              .map((item) => (
                <li key={jobIdentity(item)} className="flex flex-wrap items-center gap-2 p-3">
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => reopen(item)}
                    className="min-h-11 min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm text-fg">
                      {item.title ||
                        (item.source?.kind === "upload" && item.source.fileName) ||
                        item.videoId}
                    </span>
                    <span className="block text-xs text-subtle">
                      {item.source?.kind === "upload"
                        ? (item.upload?.status ?? "completed")
                        : "YouTube"}{" "}
                      · {item.language} · {relativeTime(item.createdAt)}
                    </span>
                  </button>
                  <Button
                    disabled={busy}
                    variant="ghost"
                    aria-label={`Rename ${item.title}`}
                    onClick={() => void renameJob(item)}
                  >
                    Rename
                  </Button>
                  <Button
                    disabled={busy}
                    variant="danger"
                    aria-label={`Delete ${item.title}`}
                    onClick={() => void removeJob(item)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
          </ul>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted">
              Completed and unfinished recordings will appear here. Export a backup to keep a copy
              outside this browser.
            </p>
          ) : null}
        </section>
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
        <p className="text-xs leading-relaxed text-subtle">
          Personal research use. YouTube mode reads public captions. Uploaded media is processed
          locally; small audio segments are sent securely to the configured transcription provider.
          INTERTEXT maintains no permanent server-side media library. Transcript history stays in
          this browser.
        </p>
      </footer>
    </div>
  );
}
