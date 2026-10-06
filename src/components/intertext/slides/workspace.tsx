import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadUtf8, sanitizeFilename } from "@/lib/intertext/export";
import { getSettings, jobIdentity, setSettings } from "@/lib/intertext/storage";
import type { Job } from "@/lib/intertext/types";
import {
  getAsset,
  putAsset,
  withSlideLock,
  slideLockIdentity,
} from "@/lib/intertext/slides/assets";
import { defaultSlideSettings, FULL_CORNERS, SlideFailure } from "@/lib/intertext/slides/config";
import { createFrameSource, inspectSlideFile } from "@/lib/intertext/slides/frame-source";
import { canvasPng, captureEvidence } from "@/lib/intertext/slides/images";
import { regionAt, validCorners } from "@/lib/intertext/slides/roi";
import { scanSlides } from "@/lib/intertext/slides/scan";
import { getSlideConfiguration, slideProvider } from "@/lib/intertext/slides/client";
import { extractSlides, unknownReserve } from "@/lib/intertext/slides/pipeline";
import { knownCost, operationEstimate } from "@/lib/intertext/slides/pricing";
import { exportSlides, formatSlideTime } from "@/lib/intertext/slides/export";
import { validateSlideSettings } from "@/lib/intertext/slides/schema";
import { regenerateEvidence } from "@/lib/intertext/slides/recovery";
import type {
  Corners,
  DisplayState,
  SlideConfiguration,
  SlideSettings,
} from "@/lib/intertext/slides/types";
import { RoiEditor } from "./roi-editor";
import { CandidateGallery, SlideReview } from "./gallery";

export function SlidesWorkspace({
  job,
  onPersist,
  onNew,
  onBusy,
}: {
  job: Job | null;
  onPersist: (job: Job) => Promise<void>;
  onNew: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const selected = job?.processingMode === "slides" ? job : undefined;
  const current = useRef(selected);
  current.current = selected;
  const [file, setFile] = useState<File>(),
    [url, setUrl] = useState<string>(),
    [seed, setSeed] = useState(defaultSlideSettings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("Select one local MP4. Audio is ignored."),
    [fallback, setFallback] = useState(false),
    [original, setOriginal] = useState<string>(),
    [corrected, setCorrected] = useState<string>(),
    [corners, setCorners] = useState<Corners>(structuredClone(FULL_CORNERS)),
    [previewTime, setPreviewTime] = useState(0),
    [active, setActive] = useState<string>(),
    [configuration, setConfiguration] = useState<SlideConfiguration>(),
    [code, setCode] = useState(""),
    [approved, setApproved] = useState(false),
    [unknownApproved, setUnknownApproved] = useState(false),
    [bom, setBom] = useState(true);
  const video = useRef<HTMLVideoElement>(null),
    abort = useRef<AbortController | null>(null),
    running = useRef(false),
    fingerprint = useRef<string | undefined>(undefined);
  const settings = selected?.slides?.settings ?? seed,
    data = selected?.slides;
  useEffect(() => {
    void getSettings<SlideSettings>("slides")
      .then((value) => {
        if (value) setSeed(value);
      })
      .catch((e) => setError(e.message));
    void getSlideConfiguration()
      .then(setConfiguration)
      .catch((e) => setError(e.message));
    return () => {
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const object = URL.createObjectURL(file);
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [file]);
  useEffect(
    () => () => {
      if (original) URL.revokeObjectURL(original);
    },
    [original],
  );
  useEffect(
    () => () => {
      if (corrected) URL.revokeObjectURL(corrected);
    },
    [corrected],
  );
  const identity = selected ? jobIdentity(selected) : undefined;
  useEffect(() => {
    const displayed = current.current;
    setApproved(false);
    setUnknownApproved(false);
    setActive(undefined);
    if (
      displayed?.source?.kind === "upload" &&
      displayed.source.fingerprint !== fingerprint.current
    ) {
      setFile(undefined);
      setOriginal(undefined);
      setCorrected(undefined);
    }
    if (displayed?.slides)
      setCorners(
        structuredClone(
          regionAt(displayed.slides.settings.regions, displayed.slides.scanCursor).corners,
        ),
      );
  }, [identity]); // Identity change only; edits must not reset playback/selection.
  async function persist(next: Job) {
    current.current = next;
    await onPersist(structuredClone(next));
  }
  async function guarded(action: (signal: AbortSignal) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await action(controller.signal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Visual processing stopped.");
    } finally {
      running.current = false;
      setBusy(false);
      abort.current = null;
    }
  }
  async function selectFile(next: File) {
    await guarded(async (signal) => {
      const hash = await inspectSlideFile(next, signal);
      const existing = current.current;
      if (
        existing?.source?.kind === "upload" &&
        (existing.source.fingerprint !== hash ||
          existing.source.sizeBytes !== next.size ||
          existing.source.lastModified !== next.lastModified)
      )
        throw new SlideFailure(
          "This file does not match the saved recording. Use New visual job for a different file. A sampled fingerprint is a convenience check, not a whole-file identity proof.",
          "source_mismatch",
        );
      const source = await createFrameSource(next, signal, fallback);
      try {
        if (
          existing?.slides &&
          (Math.abs(existing.durationSec - source.duration) > 0.1 ||
            existing.slides.width !== source.width ||
            existing.slides.height !== source.height)
        )
          throw new SlideFailure(
            "Saved duration/dimensions do not match this recording.",
            "source_mismatch",
          );
        fingerprint.current = hash;
        setFile(next);
        const nextJob: Job = existing ?? {
          id: crypto.randomUUID(),
          processingMode: "slides",
          source: {
            kind: "upload",
            fileName: next.name,
            mimeType: "video/mp4",
            sizeBytes: next.size,
            lastModified: next.lastModified,
            fingerprint: hash,
          },
          title: next.name,
          language: "visible original",
          requestedLang: "auto",
          sourceType: "visual",
          provider: "openai",
          providerLabel: "Slide image extraction",
          segmentCount: 0,
          durationSec: source.duration,
          createdAt: Date.now(),
          segments: [],
          paragraphs: [],
          availableLanguages: [],
          summaryKind: "general",
          summary: "",
          timestampQuality: "none",
          slides: {
            version: 1,
            status: "ready",
            settings: structuredClone(seed),
            width: source.width,
            height: source.height,
            rotation: source.rotation,
            decoder: source.decoder,
            scanCursor: 0,
            scanComplete: false,
            states: [],
            audit: [],
            approvedStateIds: [],
            unknownBilling: 0,
          },
        };
        await persist(nextJob);
        setProgress(
          `${next.name} · ${(next.size / 1_000_000).toFixed(1)} MB · ${formatSlideTime(source.duration)} · ${source.width}×${source.height} · ${source.decoder}`,
        );
        const frame = await source.capture(0, 768, undefined, signal);
        setOriginal(URL.createObjectURL(await canvasPng(frame.canvas)));
        frame.canvas.width = 0;
        frame.canvas.height = 0;
      } finally {
        await source.close();
      }
    });
  }
  async function updateSettings(patch: Partial<SlideSettings>) {
    setApproved(false);
    try {
      const nextSettings = validateSlideSettings({ ...settings, ...patch });
      setSeed(nextSettings);
      await setSettings("slides", nextSettings);
      if (current.current?.slides)
        await persist({
          ...current.current,
          slides: { ...current.current.slides, settings: nextSettings, approvedStateIds: [] },
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid settings.");
    }
  }
  async function capturePreview() {
    if (!file) return;
    await guarded(async (signal) => {
      if (!validCorners(corners)) throw new SlideFailure("Correct the four ROI corners first.");
      const time = video.current?.currentTime ?? previewTime;
      const source = await createFrameSource(file, signal, fallback);
      try {
        const originalFrame = await source.capture(time, 768, undefined, signal),
          regionFrame = await source.capture(
            time,
            768,
            { time, corners, method: "projective-mesh-v1" },
            signal,
          );
        setOriginal(URL.createObjectURL(await canvasPng(originalFrame.canvas)));
        setCorrected(URL.createObjectURL(await canvasPng(regionFrame.canvas)));
        originalFrame.canvas.width = 0;
        regionFrame.canvas.width = 0;
        setPreviewTime(time);
      } finally {
        await source.close();
      }
    });
  }
  async function recoverImages() {
    if (!file || !current.current?.slides) return;
    await guarded(async (signal) => {
      const source = await createFrameSource(file, signal, fallback);
      try {
        await regenerateEvidence({
          job: current.current!,
          source,
          signal,
          save: persist,
          getAsset,
          saveAsset: (id, blob) => putAsset(jobIdentity(current.current!), id, blob),
          onProgress: (done, total) =>
            setProgress(`Regenerating missing evidence · ${done} / ${total} · no model calls`),
        });
      } finally {
        await source.close();
      }
    });
  }
  async function applyRegion() {
    if (!validCorners(corners)) {
      setError("Choose a convex clockwise region.");
      return;
    }
    const time = data?.scanCursor ? previewTime : 0;
    await updateSettings({
      regions: [
        ...settings.regions.filter((r) => Math.abs(r.time - time) > 0.05),
        { time, corners: structuredClone(corners), method: "projective-mesh-v1" as const },
      ].sort((a, b) => a.time - b.time),
    });
  }
  async function scan() {
    if (!file || !current.current) return;
    await guarded(async (signal) => {
      await withSlideLock(slideLockIdentity(current.current!), signal, async (leaseCheck) => {
        const source = await createFrameSource(file, signal, fallback);
        try {
          const result = await scanSlides({
            job: current.current!,
            source,
            signal,
            save: persist,
            saveAsset: (id, blob) => putAsset(jobIdentity(current.current!), id, blob),
            leaseCheck,
            onProgress: (time, total, count) =>
              setProgress(
                `Scanning local video · ${formatSlideTime(time)} / ${formatSlideTime(total)} · ${count} states · no model calls`,
              ),
          });
          if (result.slides?.status === "paused") {
            setPreviewTime(result.slides.scanCursor);
            if (video.current) video.current.currentTime = result.slides.scanCursor;
          }
        } finally {
          await source.close();
        }
      });
    });
  }
  async function runExtraction(retryCropIds?: string[]) {
    if (!current.current?.slides) return;
    if (!approved) {
      setError("Approve the selected states and USD estimate before a paid request.");
      return;
    }
    await guarded(async (signal) => {
      const config = await getSlideConfiguration(signal);
      setConfiguration(config);
      if (
        configuration &&
        JSON.stringify(configuration.profiles) !== JSON.stringify(config.profiles)
      ) {
        setApproved(false);
        throw new SlideFailure(
          "Server model/detail/output/pricing settings changed. Review the new estimate and approve again.",
        );
      }
      if (!config.configured)
        throw new SlideFailure(config.message ?? "Server configuration is missing.");
      if (code.length < 24)
        throw new SlideFailure("Enter your random 24+ character personal access code.");
      const next = structuredClone(current.current!);
      next.slides!.approvedStateIds = next
        .slides!.states.filter((s) => s.selected)
        .map((s) => s.id);
      await persist(next);
      await withSlideLock(slideLockIdentity(next), signal, async (leaseCheck) => {
        await extractSlides({
          job: next,
          provider: slideProvider(code),
          profiles: config.profiles,
          signal,
          save: persist,
          loadAsset: getAsset,
          leaseCheck,
          retryCropIds: retryCropIds ? new Set(retryCropIds) : undefined,
          approveUnknown: unknownApproved,
          onProgress: (done, total) =>
            setProgress(`Extracting approved images · ${done} / ${total} crops · audio ignored`),
        });
      });
    });
  }
  async function changeState(next: DisplayState) {
    const job = current.current;
    if (!job?.slides) return;
    if (next.start > job.durationSec || next.end > job.durationSec) {
      setError("State boundaries must stay within the recording duration.");
      return;
    }
    setApproved(false);
    await persist({
      ...job,
      slides: {
        ...job.slides,
        approvedStateIds: [],
        states: job.slides.states
          .map((s) => (s.id === next.id ? next : s))
          .sort((a, b) => a.start - b.start),
        audit:
          next.status === "excluded" &&
          !job.slides.audit.some((a) => a.id === `excluded:${next.id}`)
            ? [
                ...job.slides.audit,
                {
                  id: `excluded:${next.id}`,
                  start: next.start,
                  end: next.end,
                  kind: "excluded",
                  note: "Reviewer excluded this appearance. Raw evidence and edits are retained.",
                },
              ]
            : job.slides.audit,
      },
    }).catch((e) => setError(e.message));
  }
  async function replacement(insert = false) {
    if (!file || !current.current?.slides) return;
    await guarded(async (signal) => {
      const next = structuredClone(current.current!),
        source = await createFrameSource(file, signal, fallback);
      try {
        const time = video.current?.currentTime ?? previewTime,
          roi = { time, corners: structuredClone(corners), method: "projective-mesh-v1" as const },
          evidence = await captureEvidence(
            source,
            time,
            roi,
            crypto.randomUUID(),
            (id, blob) => putAsset(jobIdentity(next), id, blob),
            signal,
          );
        let state = next.slides!.states.find((s) => s.id === active);
        if (!insert && state && (time < state.start || time >= state.end))
          throw new SlideFailure(
            "Replacement must be inside this state's interval. Insert a missed state for a different appearance.",
          );
        if (insert || !state) {
          state = {
            id: crypto.randomUUID(),
            start: time,
            end: Math.min(time + 1, next.durationSec),
            startBoundary: { low: time, high: time, method: evidence.time.method, uncertain: true },
            endBoundary: {
              low: time,
              high: Math.min(time + 1, next.durationSec),
              method: evidence.time.method,
              uncertain: true,
            },
            selected: true,
            status: "pending",
            flags: ["boundary-uncertain"],
            evidence: [evidence],
            representativeId: evidence.id,
            attempts: [],
            edits: {},
          };
          next.slides!.states.push(state);
          next.slides!.states.sort((a, b) => a.start - b.start);
          setActive(state.id);
        } else {
          if (state.evidence.length >= 3)
            throw new SlideFailure(
              "Three alternative evidence frames are already retained. Start another manually inserted state to preserve additional evidence.",
            );
          state.evidence.push(evidence);
          state.representativeId = evidence.id;
          state.status = "pending";
        }
        next.slides!.approvedStateIds = [];
        await persist(next);
        setApproved(false);
      } finally {
        await source.close();
      }
    });
  }
  const profile = configuration?.profiles.find((p) => p.id === settings.profile),
    states = data?.states ?? [];
  const selectedStates = states.filter((s) => s.selected && s.status !== "excluded");
  const calls = selectedStates.reduce(
    (n, s) => n + (s.evidence.find((e) => e.id === s.representativeId)?.crops.length ?? 0),
    0,
  );
  const estimate = profile
    ? selectedStates.reduce(
        (n, s) =>
          n +
          (s.evidence
            .find((e) => e.id === s.representativeId)
            ?.crops.reduce(
              (sum, c) =>
                sum +
                operationEstimate(
                  c.width,
                  c.height,
                  profile,
                  settings.inputTokensPerMegapixel,
                  settings.outputAllowance,
                  settings.allowance,
                ),
              0,
            ) ?? 0),
        0,
      )
    : undefined;
  const activeState = states.find((s) => s.id === active) ?? states[0];
  return (
    <div
      className="slides-workspace min-w-0 space-y-5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && e.dataTransfer.files[0]) void selectFile(e.dataTransfer.files[0]);
      }}
    >
      <section className="space-y-4 rounded-xl border border-border bg-panel p-5">
        <div>
          <h2 className="font-serif text-xl">MP4 TO TEXT</h2>
          <p className="text-sm text-muted">Slide text only — audio ignored</p>
        </div>
        <p className="text-sm text-muted">
          Drop one presentation video. Preview, choose the slide region, scan locally, review
          candidates, then approve image extraction. The original MP4 stays on your computer.
        </p>
        <label className="block text-sm">
          {selected
            ? "Re-select original recording for playback / resume"
            : "Select local presentation MP4"}
          <Input
            aria-label="Select slide MP4"
            type="file"
            accept=".mp4,video/mp4"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void selectFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={fallback}
            disabled={busy}
            onChange={(e) => setFallback(e.target.checked)}
          />
          Use video-only FFmpeg fallback (slower; codec/resource support varies)
        </label>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setFile(undefined);
            fingerprint.current = undefined;
            setOriginal(undefined);
            setCorrected(undefined);
            setApproved(false);
            onNew();
          }}
        >
          New visual job
        </Button>
        {url ? (
          <video
            ref={video}
            src={url}
            controls
            muted
            playsInline
            aria-label="Local slide video preview"
            className="max-h-96 w-full rounded-lg bg-bg"
          />
        ) : null}
        {file ? (
          <>
            <Button disabled={busy} variant="secondary" onClick={() => void capturePreview()}>
              Capture preview at playback position
            </Button>
            <RoiEditor
              original={original}
              corrected={corrected}
              corners={corners}
              onChange={(value) => {
                setCorners(value);
                setApproved(false);
              }}
              disabled={busy}
            />
            <Button
              disabled={busy || !validCorners(corners)}
              variant="secondary"
              onClick={() => void applyRegion()}
            >
              Apply ROI keyframe at {formatSlideTime(data?.scanCursor ? previewTime : 0)}
            </Button>
          </>
        ) : null}
        <details>
          <summary className="min-h-11 cursor-pointer text-sm">
            Detection, safeguards and model settings
          </summary>
          <div className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-3">
            {(
              [
                { key: "sampleRate", label: "Local samples / second", min: 0.5, max: 4, step: 0.5 },
                { key: "sensitivity", label: "Sensitivity", min: 0.5, max: 3, step: 0.25 },
                { key: "maxCandidates", label: "Candidate safeguard", min: 2, max: 1000, step: 1 },
                { key: "maxRequests", label: "Request safeguard", min: 1, max: 2000, step: 1 },
                { key: "budgetUsd", label: "Job budget USD", min: 0.01, max: 1000, step: 0.5 },
                {
                  key: "outputAllowance",
                  label: "Output token allowance",
                  min: 512,
                  max: 8192,
                  step: 512,
                },
                {
                  key: "inputTokensPerMegapixel",
                  label: "Planning input tokens / MP",
                  min: 100,
                  max: 100000,
                  step: 100,
                },
              ] as const
            ).map((opt) => (
              <label key={opt.key} className="text-xs">
                {opt.label}
                <Input
                  aria-label={opt.label}
                  type="number"
                  min={opt.min}
                  max={opt.max}
                  step={opt.step}
                  value={settings[opt.key]}
                  disabled={busy}
                  onChange={(e) => void updateSettings({ [opt.key]: Number(e.target.value) })}
                />
              </label>
            ))}
            <label className="text-xs">
              Extraction profile
              <select
                aria-label="Slide extraction profile"
                className="min-h-11 w-full rounded-lg border border-border bg-bg p-2"
                value={settings.profile}
                disabled={busy}
                onChange={(e) =>
                  void updateSettings({ profile: e.target.value as SlideSettings["profile"] })
                }
              >
                <option value="standard">Standard · Sol · low</option>
                <option value="economy">Economy · Luna · compare first</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">
            Default 2 Hz / 768 px detection; refinement targets 0.1–0.25 second brackets. Brief
            content can be missed. Economy accuracy is unvalidated: approve a small pilot, inspect
            it, then compare the same state with Standard before choosing it for a recording.
          </p>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !file || data?.scanComplete} onClick={() => void scan()}>
            {data?.scanCursor ? "Resume local scan" : "Scan slide candidates locally"}
          </Button>
          {busy ? (
            <>
              <Button variant="secondary" onClick={() => abort.current?.abort()}>
                Pause · keep checkpoints
              </Button>
              <Button variant="danger" onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            </>
          ) : null}
          <Button disabled={busy || !file} variant="ghost" onClick={() => void replacement(true)}>
            Insert missed state at playback time
          </Button>
          <Button
            disabled={busy || !file || !states.length}
            variant="ghost"
            onClick={() => void recoverImages()}
          >
            Regenerate missing saved evidence · no model calls
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {busy ? progress : `${data?.status ?? "ready"} · ${progress}`}
        </p>
        {error || data?.error ? (
          <p role="alert" className="text-sm text-danger">
            {error || data?.error}
          </p>
        ) : null}
      </section>
      {states.length ? (
        <>
          <CandidateGallery
            states={states}
            active={activeState?.id}
            onActive={setActive}
            onChange={(next) => void changeState(next)}
            onSeek={(time) => {
              if (video.current) video.current.currentTime = time;
            }}
            disabled={busy}
          />
          <section
            aria-label="Slide cost approval"
            className="space-y-3 rounded-xl border border-border bg-panel p-5"
          >
            <h3 className="font-medium">Review cost before extraction</h3>
            <p className="text-sm">
              {selectedStates.length} selected states · up to {calls} image operations ·{" "}
              {profile?.model ?? "model configuration unavailable"} · {profile?.detail ?? "auto"}{" "}
              detail
            </p>
            <p className="font-mono text-sm">
              Planning estimate{" "}
              {estimate === undefined ? "unavailable" : `$${estimate.toFixed(3)} USD`} · budget $
              {settings.budgetUsd.toFixed(2)} · known usage ${knownCost(states).toFixed(4)} ·
              unknown reservations ${selected ? unknownReserve(selected).toFixed(4) : "0"}
            </p>
            <p className="text-xs text-muted">
              Image tokens are estimated from dimensions with an adjustable heuristic, not a
              verified Sol/Luna token formula. Output allowance and 25% planning margin are
              included. No cache/Batch/Flex discount is assumed. This browser guardrail cannot
              enforce account-wide spending. Retries and unknown provider outcomes can incur
              charges.
            </p>
            {profile ? (
              <p className="text-xs text-muted">
                {profile.pricing.version} · verified {profile.pricing.verifiedOn} · $
                {profile.pricing.input} input / ${profile.pricing.output} output per million tokens
                · Standard service tier.
              </p>
            ) : null}
            {configuration && !configuration.configured ? (
              <p className="text-sm text-danger">{configuration.message}</p>
            ) : null}
            <label className="block text-xs">
              Personal slide access code (memory only)
              <Input
                aria-label="Personal slide access code"
                type="password"
                autoComplete="off"
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={approved}
                disabled={busy}
                onChange={(e) => setApproved(e.target.checked)}
                className="mt-1"
              />
              I approve paid extraction of the selected states at the displayed profile and
              estimate.
            </label>
            <label className="flex min-h-11 items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={unknownApproved}
                disabled={busy}
                onChange={(e) => setUnknownApproved(e.target.checked)}
              />
              I deliberately approve retrying any unknown-billing attempt; duplicate charges may
              occur.
            </label>
            <Button disabled={busy || !approved || !calls} onClick={() => void runExtraction()}>
              Extract approved slide text
            </Button>
            <p className="text-xs text-muted">
              For a pilot, select only 1–3 representative states. Completed results are saved and
              reused; completing the recording requires reviewing/selecting the remaining states.
            </p>
          </section>
          {activeState ? (
            <SlideReview
              key={activeState.id}
              state={activeState}
              onChange={(next) => void changeState(next)}
              onRetry={(ids) => void runExtraction(ids)}
              onReplace={() => void replacement()}
              onAlternative={(id) => {
                if (
                  window.confirm(
                    "Confirm this alternative shows the same visible content state. Old evidence and corrections will be kept.",
                  )
                )
                  void changeState({ ...activeState, representativeId: id, status: "pending" });
              }}
              disabled={busy}
            />
          ) : null}
          <section
            aria-label="Slide text exports"
            className="space-y-3 rounded-xl border border-border bg-panel p-5"
          >
            <p className="font-medium">Export visual text</p>
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <input type="checkbox" checked={bom} onChange={(e) => setBom(e.target.checked)} />
              Windows UTF-8 BOM
            </label>
            <div className="flex flex-wrap gap-2">
              {(["txt", "md", "json"] as const).map((format) => (
                <Button
                  key={format}
                  disabled={busy}
                  variant="secondary"
                  onClick={() => {
                    if (selected)
                      downloadUtf8(
                        `${sanitizeFilename(selected.title)}-slides.${format}`,
                        exportSlides(selected, format),
                        format === "json" ? "application/json" : "text/plain",
                        bom,
                      );
                  }}
                >
                  Export slides {format.toUpperCase()}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted">
              Text backup/JSON excludes images and the video; re-select the original recording to
              regenerate evidence. Raw extraction and manual edits are stored separately. Groups
              never combine text into a purported simultaneous frame.
            </p>
          </section>
        </>
      ) : null}
      {data?.audit.length ? (
        <details className="rounded-xl border border-border bg-panel p-4">
          <summary className="min-h-11 cursor-pointer">
            Excluded / uncertain interval audit · {data.audit.length}
          </summary>
          {data.audit.map((a) => (
            <p key={a.id} className="py-1 text-xs">
              {formatSlideTime(a.start)} – {formatSlideTime(a.end)} · {a.kind} · {a.note}
            </p>
          ))}
        </details>
      ) : null}
      <p className="text-xs leading-relaxed text-muted">
        Keep this tab open and the PC awake. Closing it stops unfinished processing; saved states
        resume after reselecting the source. Browser storage can be evicted: export an INTERTEXT
        text backup. Codec support, memory, boundary detection and recognition are fallible. Audio,
        speech transcription and summaries are never used in this mode.
      </p>
    </div>
  );
}
