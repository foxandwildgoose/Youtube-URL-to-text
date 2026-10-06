import type { Job } from "../types.ts";
import { checkAbort, SlideFailure } from "./config.ts";
import { canvasFeature, compareFeatures, StateDetector, type Feature } from "./detection.ts";
import { captureEvidence, type AssetWriter } from "./images.ts";
import { regionAt } from "./roi.ts";
import type { Boundary, DisplayState, FrameSource, FrameTiming } from "./types.ts";
export type ScanOptions = {
  job: Job;
  source: FrameSource;
  signal: AbortSignal;
  save: (job: Job) => Promise<void>;
  saveAsset: AssetWriter;
  onProgress: (time: number, total: number, count: number) => void;
  leaseCheck?: () => Promise<void>;
  feature?: (canvas: HTMLCanvasElement) => Feature;
  evidence?: typeof captureEvidence;
};
export async function refineBoundary(
  source: FrameSource,
  baseline: Feature,
  low: number,
  high: number,
  job: Job,
  signal: AbortSignal,
  feature = canvasFeature,
): Promise<Boundary> {
  const settings = job.slides!.settings;
  let method: FrameTiming["method"] = "seeked-fallback",
    uncertainty = 0.25;
  while (high - low > settings.refineStep) {
    checkAbort(signal);
    const t = (low + high) / 2;
    const f = await source.capture(
      t,
      settings.detectionWidth,
      regionAt(settings.regions, t),
      signal,
    );
    try {
      const changed = compareFeatures(baseline, feature(f.canvas), settings.sensitivity).changed;
      method = f.timing.method;
      uncertainty = f.timing.uncertaintySec;
      if (changed) high = t;
      else low = t;
    } finally {
      f.canvas.width = 0;
      f.canvas.height = 0;
    }
  }
  return {
    low: Math.max(0, low - uncertainty),
    high: Math.min(source.duration, high + uncertainty),
    method,
    uncertain: true,
  };
}
/** Streaming detection retains uncertain short states as evidence rather than erasing them. */
export async function scanSlides(options: ScanOptions): Promise<Job> {
  const { source, signal, save, saveAsset, onProgress } = options,
    feature = options.feature ?? canvasFeature,
    evidenceCapture = options.evidence ?? captureEvidence;
  const job = structuredClone(options.job);
  if (!job.slides) throw new SlideFailure("This is not a visual job.");
  const data = job.slides,
    settings = data.settings;
  data.status = "scanning";
  data.scanComplete = false;
  delete data.error;
  await save(job);
  const detector = new StateDetector(settings.sensitivity, settings.stableSamples);
  let current: DisplayState | undefined = data.states.at(-1),
    pendingSince: number | undefined,
    previousFeature: Feature | undefined,
    previousTime = Math.max(0, data.scanCursor - 1 / settings.sampleRate),
    savedAt = data.scanCursor;
  // A reviewer-supplied keyframe at a paused region establishes a fresh comparison
  // baseline while retaining the previous appearance/evidence.
  const resumeRegion = regionAt(settings.regions, data.scanCursor);
  if (
    current &&
    current.flags.includes("region-review") &&
    resumeRegion.time >= data.scanCursor - 0.05
  )
    current = undefined;
  let gap: { start: number; kind: "black" | "unobservable" } | undefined;
  const closeGap = (end: number) => {
    if (gap && end > gap.start)
      data.audit.push({
        id: crypto.randomUUID(),
        start: gap.start,
        end,
        kind: gap.kind,
        note: "Locally observed gap; semantic classification requires source review.",
      });
    gap = undefined;
  };
  if (current) {
    const f = await source.capture(
      current.evidence.find((e) => e.id === current!.representativeId)!.time.actual,
      settings.detectionWidth,
      regionAt(settings.regions, current.start),
      signal,
    );
    detector.baseline = feature(f.canvas);
    previousFeature = detector.baseline;
    f.canvas.width = 0;
    f.canvas.height = 0;
  }
  const pause = async (time: number, message: string) => {
    data.status = "paused";
    data.error = message;
    data.scanCursor = time;
    await save(job);
    return job;
  };
  async function createState(time: number, boundary: Boundary, uncertain: boolean): Promise<void> {
    const start =
      data.states.length === 0 && time < 1 / settings.sampleRate
        ? 0
        : (boundary.low + boundary.high) / 2;
    if (current) {
      current.end = Math.max(current.start, start);
      current.endBoundary = boundary;
    }
    closeGap(start);
    const id = crypto.randomUUID(),
      roi = regionAt(settings.regions, time);
    const evidence = await evidenceCapture(source, time, roi, id, saveAsset, signal);
    current = {
      id,
      start,
      end: time,
      startBoundary: boundary,
      endBoundary: { low: time, high: time, method: evidence.time.method, uncertain: true },
      selected: true,
      status: "pending",
      flags: [
        "boundary-uncertain",
        ...(uncertain ? ["dynamic" as const, "incomplete" as const] : []),
      ],
      evidence: [evidence],
      representativeId: evidence.id,
      attempts: [],
      edits: {},
    };
    data.states.push(current);
    await save(job);
  }
  try {
    for (let t = data.scanCursor; t < source.duration; t += 1 / settings.sampleRate) {
      await options.leaseCheck?.();
      checkAbort(signal);
      const roi = regionAt(settings.regions, t),
        frame = await source.capture(t, settings.detectionWidth, roi, signal);
      let f: Feature;
      try {
        f = feature(frame.canvas);
      } finally {
        frame.canvas.width = 0;
        frame.canvas.height = 0;
      }
      const before = detector.baseline,
        decision = detector.push(f, frame.timing.actual);
      if (decision.kind === "black" || decision.kind === "unobservable") {
        if (current) {
          current.end = Math.max(current.start, (previousTime + frame.timing.actual) / 2);
          current.endBoundary = {
            low: previousTime,
            high: frame.timing.actual,
            method: frame.timing.method,
            uncertain: true,
          };
          current = undefined;
        }
        gap ??= { start: (previousTime + frame.timing.actual) / 2, kind: decision.kind };
        pendingSince = undefined;
      } else if (decision.kind === "candidate" && pendingSince !== decision.since) {
        if (data.states.length >= settings.maxCandidates)
          return pause(
            t,
            "Candidate safeguard reached. Review ROI/dynamic content or raise the limit deliberately. The remaining video is NOT scanned.",
          );
        let boundary: Boundary = {
          low: previousTime,
          high: frame.timing.actual,
          method: frame.timing.method,
          uncertain: true,
        };
        if (before && previousFeature && t > 0)
          boundary = await refineBoundary(
            source,
            previousFeature,
            previousTime,
            frame.timing.actual,
            job,
            signal,
            feature,
          );
        await createState(frame.timing.actual, boundary, true);
        if (current && before && !compareFeatures(before, f, settings.sensitivity).changed)
          current.flags.push("possible-duplicate");
        pendingSince = decision.since;
      } else if (decision.kind === "stable") {
        if (current && pendingSince === decision.since) {
          const alternative = await evidenceCapture(
            source,
            frame.timing.actual,
            roi,
            crypto.randomUUID(),
            saveAsset,
            signal,
          );
          current.evidence.push(alternative);
          if (alternative.sharpness >= current.evidence[0]!.sharpness)
            current.representativeId = alternative.id;
          current.flags = current.flags.filter(
            (flag) => flag !== "incomplete" && flag !== "dynamic",
          );
          current.end = frame.timing.actual;
        } else {
          if (data.states.length >= settings.maxCandidates)
            return pause(t, "Candidate safeguard reached; remaining video is unscanned.");
          await createState(
            frame.timing.actual,
            {
              low: previousTime,
              high: frame.timing.actual,
              method: frame.timing.method,
              uncertain: true,
            },
            false,
          );
        }
        pendingSince = undefined;
        await save(job);
        savedAt = t;
      } else if (decision.kind === "same") {
        if (pendingSince !== undefined) {
          if (current)
            data.audit.push({
              id: crypto.randomUUID(),
              start: current.start,
              end: frame.timing.actual,
              kind: "transition",
              note: "Short/unstable state retained with evidence; inspect possible fade/occlusion.",
            });
          if (data.states.length >= settings.maxCandidates)
            return pause(t, "Candidate safeguard reached; remaining video is unscanned.");
          await createState(
            frame.timing.actual,
            {
              low: previousTime,
              high: frame.timing.actual,
              method: frame.timing.method,
              uncertain: true,
            },
            false,
          );
          pendingSince = undefined;
        }
        if (current) {
          current.end = frame.timing.actual;
          current.endBoundary = {
            low: frame.timing.actual,
            high: Math.min(source.duration, frame.timing.actual + 1 / settings.sampleRate),
            method: frame.timing.method,
            uncertain: true,
          };
          if (decision.motion) {
            current.flags = [...new Set([...current.flags, "region-review" as const])];
            return pause(
              t,
              "Camera movement / low-confidence visual change needs review. Check the original frame, correct ROI at this time, or insert a missed state before resuming.",
            );
          }
        }
      }
      data.scanCursor = Math.min(source.duration, t + 1 / settings.sampleRate);
      onProgress(data.scanCursor, source.duration, data.states.length);
      if (t - savedAt >= 10) {
        await save(job);
        savedAt = t;
      }
      if (decision.kind === "same" || decision.kind === "stable") previousFeature = f;
      previousTime = frame.timing.actual;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const last = await source.capture(
      source.duration - 0.001,
      settings.detectionWidth,
      regionAt(settings.regions, source.duration),
      signal,
    );
    const lastFeature = feature(last.canvas);
    last.canvas.width = 0;
    last.canvas.height = 0;
    if (
      current &&
      pendingSince === undefined &&
      !lastFeature.black &&
      !lastFeature.unobservable &&
      detector.baseline &&
      !compareFeatures(detector.baseline, lastFeature, settings.sensitivity).changed
    )
      current.end = source.duration;
    else if (current) {
      current.flags = [...new Set([...current.flags, "incomplete" as const])];
      data.audit.push({
        id: crypto.randomUUID(),
        start: current.end,
        end: source.duration,
        kind: "transition",
        note: "Final visibility is unverified; slide was not extended to recording end.",
      });
    }
    closeGap(source.duration);
    data.scanCursor = source.duration;
    data.scanComplete = true;
    data.status = "review";
    await save(job);
    return job;
  } catch (error) {
    data.status = signal.aborted ? "cancelled" : "failed";
    data.error = error instanceof Error ? error.message : "Local scanning failed.";
    await save(job);
    throw error;
  }
}
