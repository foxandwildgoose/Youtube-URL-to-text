import { useEffect, useRef, useState } from "react";
import { FileAudio, LoaderCircle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDurationClock } from "@/lib/intertext/clean";
import { getSettings, setSettings as setStoredSettings } from "@/lib/intertext/storage";
import type { Job } from "@/lib/intertext/types";
import type {
  ContentMode,
  MediaError,
  MediaProgress,
  UploadLanguage,
  UploadSettings,
} from "@/lib/intertext/media-types";
import {
  OpenAITranscriptionProvider,
  checkTranscriptionConfiguration,
} from "@/lib/intertext/transcription-client";
import {
  MAX_KEYWORDS,
  MAX_KEYWORD_CHARS,
  MAX_PROMPT_CHARS,
} from "@/lib/intertext/transcription-contract";
import { SegmentedControl } from "./segmented-control";

const LANGUAGES: Array<{ id: UploadLanguage; label: string }> = [
  { id: "ko-en", label: "Korean + English" },
  { id: "ko", label: "Korean" },
  { id: "en", label: "English" },
  { id: "auto", label: "Auto" },
];
const CONTENT: Array<{ id: ContentMode; label: string }> = [
  { id: "ai-conference", label: "AI Conference" },
  { id: "lecture", label: "Lecture" },
  { id: "meeting", label: "Meeting" },
  { id: "interview", label: "Interview" },
  { id: "podcast", label: "Podcast" },
  { id: "speech", label: "General Speech" },
  { id: "lyrics", label: "Lyrics β" },
];
const STAGES = [
  { statuses: ["inspecting", "preparing"], label: "Reading media" },
  { statuses: ["extracting-audio"], label: "Preparing audio processor" },
  { statuses: ["analyzing-boundaries"], label: "Finding safe boundaries" },
  { statuses: ["chunking"], label: "Extracting and compressing audio" },
  { statuses: ["transcribing"], label: "Transcribing" },
  { statuses: ["merging", "postprocessing"], label: "Merging transcript" },
];

export function UploadWorkspace({
  job,
  onJob,
  onPersist,
  onMedia,
  onBusy,
  onNew,
  externalDisabled = false,
}: {
  job: Job | null;
  onJob: (job: Job) => void;
  onPersist: (job: Job) => Promise<void>;
  onMedia: (url: string | undefined) => void;
  onBusy: (busy: boolean) => void;
  onNew: () => void;
  externalDisabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [localMediaUrl, setLocalMediaUrl] = useState<string | undefined>();
  const [metadata, setMetadata] = useState<{
    durationSec: number;
    mimeType: string;
    fingerprint: string;
  } | null>(null);
  const [settings, setSettings] = useState<UploadSettings>({
    language: "ko-en",
    contentMode: "ai-conference",
    keywords: [],
  });
  const [keywords, setKeywords] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<MediaProgress | null>(null);
  const [failure, setFailure] = useState<MediaError | null>(null);
  const [config, setConfig] = useState<{
    configured: boolean;
    model: string;
    message?: string;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const processingLock = useRef(false);
  const currentJob = useRef(job);
  currentJob.current = job;
  const selectedJobId = job?.id;
  const inspectController = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const settingsLoaded = useRef(false);
  const restoredId = useRef<string | undefined>(undefined);
  const onMediaRef = useRef(onMedia);
  onMediaRef.current = onMedia;

  useEffect(() => {
    let alive = true;
    void checkTranscriptionConfiguration()
      .then((value) => {
        if (alive) setConfig(value);
      })
      .catch(() => {
        if (alive)
          setConfig({
            configured: false,
            model: "",
            message: "Could not reach transcription settings. Retry before starting.",
          });
      });
    void Promise.all([
      getSettings<UploadSettings>("upload"),
      import("@/lib/intertext/media-config"),
    ])
      .then(([stored, defaults]) => {
        if (!alive) return;
        const initial = stored ?? {
          language: "ko-en",
          contentMode: "ai-conference",
          keywords: [...defaults.DEFAULT_AI_KEYWORDS],
        };
        if (!restoredId.current) {
          setSettings(initial);
          setKeywords(initial.keywords.join(", "));
        }
        settingsLoaded.current = true;
      })
      .catch(() => {
        if (alive) settingsLoaded.current = true;
      });
    return () => {
      alive = false;
      controller.current?.abort();
      inspectController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setLocalMediaUrl(undefined);
      onMediaRef.current(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalMediaUrl(url);
    onMediaRef.current(url);
    return () => {
      URL.revokeObjectURL(url);
      onMediaRef.current(undefined);
    };
  }, [file]);

  useEffect(() => {
    if (job?.source?.kind !== "upload" || restoredId.current === job.id) return;
    restoredId.current = job.id;
    if (job.upload) {
      setSettings(job.upload.settings);
      setKeywords(job.upload.settings.keywords.join(", "));
    }
  }, [job]);

  useEffect(() => {
    inspectController.current?.abort();
  }, [selectedJobId]);

  function report(error: unknown) {
    const value = error as Partial<MediaError>;
    setFailure({
      code: value.code ?? "media_decode_failed",
      message: value.message ?? "This media could not be processed.",
      details: value.details,
    });
  }

  async function selectFile(candidate: File) {
    if (processingLock.current || externalDisabled) return;
    inspectController.current?.abort();
    const abort = new AbortController();
    inspectController.current = abort;
    setBusy(true);
    onBusy(true);
    setFailure(null);
    setMetadata(null);
    setFile(null);
    setProgress({
      status: "inspecting",
      message: "Reading media metadata…",
      completed: 0,
      total: 0,
    });
    try {
      const { inspectMedia } = await import("@/lib/intertext/media-inspect");
      const info = await inspectMedia(candidate, abort.signal);
      if (abort.signal.aborted) return;
      const selected = currentJob.current;
      if (selected?.source?.kind === "upload" && selected.source.fingerprint !== info.fingerprint) {
        throw {
          code: "resume_file_mismatch",
          message:
            "This file does not match the saved recording. Choose its original file for playback or resume, or select New recording.",
        };
      }
      setMetadata(info);
      setFile(candidate);
      setProgress(null);
    } catch (error) {
      if (!abort.signal.aborted) {
        report(error);
        setProgress(null);
      }
    } finally {
      if (inspectController.current === abort) {
        inspectController.current = null;
        setBusy(false);
        onBusy(false);
        if (abort.signal.aborted) setProgress(null);
      }
    }
  }

  function updateSettings(next: UploadSettings) {
    setSettings(next);
    if (settingsLoaded.current) void setSettingsInStorage(next);
  }

  async function setSettingsInStorage(value: UploadSettings) {
    try {
      await setStoredSettings("upload", value);
    } catch (error) {
      report(error);
    }
  }

  async function start() {
    if (
      !file ||
      !metadata ||
      alreadyCompleted ||
      busy ||
      externalDisabled ||
      processingLock.current
    )
      return;
    processingLock.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    onBusy(true);
    setFailure(null);
    setProgress(null);
    try {
      const configuration = await checkTranscriptionConfiguration().catch(() => null);
      setConfig(configuration);
      if (abort.signal.aborted)
        throw { code: "cancelled", message: "Transcription was cancelled." };
      if (!configuration?.configured) {
        setFailure({
          code: "not_configured",
          message:
            configuration?.message ??
            "File transcription is unavailable. Configure OPENAI_API_KEY and the personal access code on the server.",
        });
        return;
      }
      if (!accessToken.trim()) {
        setFailure({
          code: "provider_auth_failed",
          message: "Enter your personal access code under Advanced options before starting.",
        });
        return;
      }
      const resume =
        job?.source?.kind === "upload" && job.upload && job.upload.status !== "completed";
      if (
        resume &&
        job?.source?.kind === "upload" &&
        job.source.fingerprint !== metadata.fingerprint
      ) {
        setFailure({
          code: "resume_file_mismatch",
          message:
            "This file does not match the saved recording. Re-select the original file to resume, or start a new recording.",
        });
        return;
      }
      const nextSettings = {
        ...settings,
        keywords: keywords
          .split(/[,\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      };
      if (
        nextSettings.keywords.length > MAX_KEYWORDS ||
        nextSettings.keywords.some(
          (term) =>
            term.length > MAX_KEYWORD_CHARS ||
            Array.from(term).some((char) => char.charCodeAt(0) < 32),
        ) ||
        (nextSettings.prompt?.length ?? 0) > MAX_PROMPT_CHARS
      ) {
        setFailure({
          code: "transcription_failed",
          message: `Use at most ${MAX_KEYWORDS} technical terms with ${MAX_KEYWORD_CHARS} characters each, and context up to ${MAX_PROMPT_CHARS} characters.`,
        });
        return;
      }
      const initial: Job = resume
        ? {
            ...job,
            upload: {
              ...job.upload!,
              settings: job.upload!.chunks.length ? job.upload!.settings : nextSettings,
            },
          }
        : {
            id: crypto.randomUUID(),
            source: {
              kind: "upload",
              fileName: file.name,
              mimeType: metadata.mimeType,
              sizeBytes: file.size,
              lastModified: file.lastModified,
              fingerprint: metadata.fingerprint,
            },
            title: file.name.replace(/\.[^.]+$/, ""),
            language: settings.language === "ko-en" ? "ko,en" : settings.language,
            requestedLang: "auto",
            sourceType: "transcription",
            provider: "openai",
            providerLabel: configuration.model,
            segmentCount: 0,
            durationSec: metadata.durationSec,
            createdAt: Date.now(),
            segments: [],
            paragraphs: [],
            availableLanguages: [],
            summaryKind:
              settings.contentMode === "ai-conference"
                ? "ai-conference"
                : settings.contentMode === "lecture"
                  ? "course"
                  : settings.contentMode === "meeting" ||
                      settings.contentMode === "interview" ||
                      settings.contentMode === "podcast"
                    ? settings.contentMode
                    : "general",
            summary: "",
            timestampQuality: "chunk-estimated",
            upload: { status: "preparing", settings: nextSettings, chunks: [], plan: [] },
          };
      onJob(initial);
      await setSettingsInStorage(nextSettings);
      const { runUpload } = await import("@/lib/intertext/upload-pipeline");
      const completed = await runUpload({
        file,
        job: initial,
        provider: new OpenAITranscriptionProvider(accessToken),
        signal: abort.signal,
        onProgress: setProgress,
        save: onPersist,
      });
      onJob(completed);
      setProgress({
        status: "completed",
        completed: completed.upload?.chunks.length ?? 0,
        total: completed.upload?.chunks.length ?? 0,
        message: "Your complete transcript is ready.",
      });
    } catch (error) {
      report(error);
    } finally {
      processingLock.current = false;
      setBusy(false);
      onBusy(false);
      controller.current = null;
    }
  }

  const incomplete =
    job?.source?.kind === "upload" && job.upload && job.upload.status !== "completed";
  const alreadyCompleted =
    job?.source?.kind === "upload" &&
    job.upload?.status === "completed" &&
    job.source.fingerprint === metadata?.fingerprint;
  const currentStage = STAGES.findIndex((stage) => stage.statuses.includes(progress?.status ?? ""));

  return (
    <section
      aria-label="Upload media"
      className="theme-surface space-y-5 rounded-xl border border-border bg-panel p-5 shadow-[var(--it-shadow-card)] sm:p-6"
    >
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const candidate = event.dataTransfer.files[0];
          if (candidate) void selectFile(candidate);
        }}
        className={`rounded-lg border border-dashed p-6 text-center ${dragging ? "border-accent bg-panel-2" : "border-border"}`}
      >
        <Upload className="mx-auto mb-3 size-6 text-accent-text" aria-hidden="true" />
        <p className="font-serif text-xl text-fg">One recording. One transcript.</p>
        <p className="mt-2 text-sm text-muted">
          Drop your GoPro video or audio here. Audio conversion and splitting are automatic.
        </p>
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => picker.current?.click()}
          disabled={busy || externalDisabled}
        >
          Browse Files
        </Button>
        <input
          ref={picker}
          type="file"
          className="sr-only"
          aria-label="Select media file"
          accept=".mp4,.mov,.webm,.mpeg,.mpg,.mp3,.m4a,.wav,.mpga,audio/*,video/*"
          disabled={busy || externalDisabled}
          onChange={(event) => {
            const candidate = event.target.files?.[0];
            if (candidate) void selectFile(candidate);
            event.target.value = "";
          }}
        />
      </div>
      {file && metadata ? (
        <div className="flex items-start gap-3 rounded-lg bg-panel-2 p-4">
          <FileAudio className="mt-1 size-5 shrink-0 text-accent-text" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="break-words font-medium text-fg">{file.name}</p>
            <p className="mt-1 text-sm tabular-nums text-muted">
              {(file.size / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB ·{" "}
              {formatDurationClock(metadata.durationSec)} · {metadata.mimeType}
            </p>
          </div>
          <Button
            variant="ghost"
            aria-label="Remove selected file"
            disabled={busy || externalDisabled}
            onClick={() => {
              setFile(null);
              setMetadata(null);
            }}
          >
            <X />
          </Button>
        </div>
      ) : null}
      {localMediaUrl && !(job?.source?.kind === "upload" && job.upload?.status === "completed") ? (
        <div>
          {metadata?.mimeType.startsWith("audio/") ? (
            <audio
              controls
              preload="metadata"
              src={localMediaUrl}
              className="w-full"
              aria-label="Selected local audio"
            />
          ) : (
            <video
              controls
              preload="metadata"
              src={localMediaUrl}
              className="max-h-80 w-full rounded-lg bg-panel-2"
              aria-label="Selected local video"
            />
          )}
        </div>
      ) : null}
      {job?.source?.kind === "upload" ? (
        <Button
          variant="ghost"
          disabled={busy || externalDisabled}
          onClick={() => {
            inspectController.current?.abort();
            setFile(null);
            setMetadata(null);
            setProgress(null);
            setFailure(null);
            restoredId.current = undefined;
            onNew();
          }}
        >
          New recording
        </Button>
      ) : null}
      {incomplete ? (
        <p className="text-sm text-accent-text">
          Resume “{job.title}”: {job.upload?.chunks.length ?? 0} completed audio sections are saved.
          Re-select the original recording; completed transcription will be reused.
        </p>
      ) : null}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted">Language</p>
        <SegmentedControl
          aria-label="Upload language"
          value={settings.language}
          onChange={(language) => updateSettings({ ...settings, language })}
          disabled={busy || externalDisabled || Boolean(incomplete && job.upload?.chunks.length)}
          className="seg-language"
          options={LANGUAGES}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted">Content type</p>
        <SegmentedControl
          aria-label="Upload content type"
          value={settings.contentMode}
          onChange={(contentMode) => updateSettings({ ...settings, contentMode })}
          disabled={busy || externalDisabled || Boolean(incomplete && job.upload?.chunks.length)}
          className="seg-grid"
          options={CONTENT}
        />
        {settings.contentMode === "lyrics" ? (
          <p className="text-xs text-muted">
            Singing recognition is experimental. Repeated lyrics are preserved.
          </p>
        ) : null}
      </div>
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium text-fg">Advanced options</summary>
        <div className="mt-4 space-y-4">
          <label className="block text-sm text-muted">
            Technical terms / names
            <textarea
              value={keywords}
              disabled={
                busy || externalDisabled || Boolean(incomplete && job.upload?.chunks.length)
              }
              onChange={(event) => {
                setKeywords(event.target.value);
                updateSettings({
                  ...settings,
                  keywords: event.target.value
                    .split(/[,\n]/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                });
              }}
              rows={4}
              maxLength={3000}
              className="mt-2 w-full rounded-md border border-border bg-bg p-3 text-fg focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <p className="text-xs text-subtle">
            Comma-separated terms are recognition hints. Keep only terms relevant to this recording.
          </p>
          <label className="block text-sm text-muted">
            Additional context
            <textarea
              rows={2}
              maxLength={1200}
              value={settings.prompt ?? ""}
              disabled={
                busy || externalDisabled || Boolean(incomplete && job.upload?.chunks.length)
              }
              onChange={(event) => updateSettings({ ...settings, prompt: event.target.value })}
              className="mt-2 w-full rounded-md border border-border bg-bg p-3 text-fg focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-sm text-muted">
            Personal access code
            <Input
              className="mt-2"
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              disabled={busy || externalDisabled}
            />
          </label>
          <p className="text-xs text-subtle">
            Use the access code set for this personal workspace. It is kept only for this session.
          </p>
        </div>
      </details>
      <div className="flex flex-wrap gap-3">
        <Button
          size="lg"
          disabled={
            !file ||
            !metadata ||
            alreadyCompleted ||
            busy ||
            externalDisabled ||
            progress?.status === "inspecting"
          }
          onClick={() => void start()}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : null}
          {alreadyCompleted
            ? "Transcription complete"
            : incomplete
              ? "Resume transcription"
              : "Start transcription"}
        </Button>
        {busy ? (
          <Button
            variant="danger"
            onClick={() => {
              controller.current?.abort();
              inspectController.current?.abort();
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
      {progress ? (
        <div aria-live="polite" role="status" className="rounded-lg bg-panel-2 p-4">
          <p className="text-sm text-fg">{progress.message}</p>
          {busy ? (
            <ol className="mt-3 space-y-2 text-sm">
              {STAGES.map((stage, index) => (
                <li
                  key={stage.label}
                  className={index === currentStage ? "text-accent-text" : "text-muted"}
                >
                  {stage.label}{" "}
                  {index < currentStage
                    ? "✓"
                    : index === currentStage && progress.status === "transcribing"
                      ? `${progress.completed} / ${progress.total}`
                      : index === currentStage
                        ? "…"
                        : ""}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      {failure ? (
        <div role="alert" className="rounded-lg border border-danger/30 p-4">
          <p className="text-sm text-danger">{failure.message}</p>
          {failure.details ? (
            <details className="mt-2 text-xs text-muted">
              <summary>Details</summary>
              <p className="mt-2 break-words">{failure.details}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {config && !config.configured ? (
        <p className="text-xs text-muted">
          {config.message ??
            "File transcription needs OPENAI_API_KEY and TRANSCRIPTION_ACCESS_TOKEN configured on the server. YouTube captions and local playback remain available."}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted">
        Keep this tab open until transcription is complete. Small audio segments are sent to OpenAI;
        your original video stays local. API billing is separate from a ChatGPT subscription.
      </p>
    </section>
  );
}
