import type { Job } from "../types.ts";
import { checkAbort, PROMPT_VERSION, SCHEMA_VERSION, SlideFailure } from "./config.ts";
import { operationKey } from "./client.ts";
import { knownCost, operationEstimate, usageCost } from "./pricing.ts";
import { imageHash } from "./images.ts";
import type { Attempt, ModelProfile, SlideProvider } from "./types.ts";
export function unknownReserve(job: Job): number {
  return job
    .slides!.states.flatMap((s) => s.attempts)
    .reduce(
      (sum, a) =>
        sum +
        (!a.reusedFrom &&
        (a.error?.billing === "unknown" || a.outcome === "completed") &&
        a.costUsd === undefined
          ? (a.reservedUsd ?? 0)
          : 0),
      0,
    );
}
export type ExtractionOptions = {
  job: Job;
  provider: SlideProvider;
  profiles: ModelProfile[];
  signal: AbortSignal;
  save: (job: Job) => Promise<void>;
  loadAsset: (id: string) => Promise<Blob | undefined>;
  leaseCheck?: () => Promise<void>;
  retryCropIds?: Set<string>;
  approveUnknown?: boolean;
  onProgress?: (done: number, total: number) => void;
};
export async function extractSlides(options: ExtractionOptions): Promise<Job> {
  const { signal, save, provider, loadAsset } = options,
    job = structuredClone(options.job);
  if (job.processingMode !== "slides" || !job.slides)
    throw new SlideFailure("Only visual jobs can use this pipeline.");
  const data = job.slides,
    settings = data.settings;
  const base = options.profiles.find((p) => p.id === settings.profile);
  if (!base) throw new SlideFailure("The selected model profile is unavailable.");
  const profile = {
    ...base,
    maxOutputTokens: Math.min(settings.outputAllowance, base.maxOutputTokens),
  };
  data.status = "extracting";
  data.pricing = options.profiles;
  delete data.error;
  await save(job);
  const approved = new Set(data.approvedStateIds),
    states = data.states.filter((s) => s.selected && s.status !== "excluded");
  const total = states.reduce(
    (n, s) => n + (s.evidence.find((e) => e.id === s.representativeId)?.crops.length ?? 0),
    0,
  );
  let done = 0;
  const cache = new Map<string, Attempt>();
  for (const a of data.states.flatMap((s) => s.attempts))
    if (a.outcome === "completed" && a.extraction) cache.set(a.operationKey, a);
  const pause = async (message: string) => {
    data.status = "paused";
    data.error = message;
    await save(job);
    return job;
  };
  const pendingKeys = new Set<string>();
  let pendingEstimate = 0;
  for (const state of states) {
    const evidence = state.evidence.find((e) => e.id === state.representativeId);
    if (!evidence) continue;
    for (const crop of evidence.crops) {
      const key = operationKey(crop, evidence.roi, profile),
        retry = options.retryCropIds?.has(crop.id);
      if ((cache.has(key) && !retry) || pendingKeys.has(key)) continue;
      pendingKeys.add(key);
      pendingEstimate += operationEstimate(
        crop.width,
        crop.height,
        profile,
        settings.inputTokensPerMegapixel,
        settings.outputAllowance,
        settings.allowance,
      );
    }
  }
  if (knownCost(data.states) + unknownReserve(job) + pendingEstimate > settings.budgetUsd)
    return pause(
      "The selected remaining plan exceeds the USD job budget. Select a smaller pilot or review and raise the budget before extraction.",
    );
  try {
    for (const state of states) {
      if (!approved.has(state.id))
        return pause(
          "This candidate was not approved for paid extraction. Review the selection and approve its cost.",
        );
      const evidence = state.evidence.find((e) => e.id === state.representativeId);
      if (!evidence)
        throw new SlideFailure("Re-select the recording and regenerate missing evidence.");
      for (const crop of evidence.crops) {
        checkAbort(signal);
        await options.leaseCheck?.();
        const key = operationKey(crop, evidence.roi, profile),
          retry = options.retryCropIds?.has(crop.id) ?? false;
        const existing = state.attempts.find(
          (a) => a.operationKey === key && a.cropId === crop.id && a.outcome === "completed",
        );
        if (existing && !retry) {
          done++;
          options.onProgress?.(done, total);
          continue;
        }
        if (
          state.attempts.some((a) => a.cropId === crop.id && a.error?.billing === "unknown") &&
          !options.approveUnknown
        )
          return pause(
            "A previous request may have been billed without a saved result. Deliberately approve an unknown-billing retry before continuing.",
          );
        const reused = cache.get(key);
        if (reused && !retry) {
          state.attempts.push({
            ...structuredClone(reused),
            id: crypto.randomUUID(),
            cropId: crop.id,
            at: Date.now(),
            costUsd: 0,
            reusedFrom: reused.id,
          });
          await save(job);
          done++;
          continue;
        }
        const estimate = operationEstimate(
          crop.width,
          crop.height,
          profile,
          settings.inputTokensPerMegapixel,
          settings.outputAllowance,
          settings.allowance,
        );
        if (knownCost(data.states) + unknownReserve(job) + estimate > settings.budgetUsd)
          return pause(
            "The next image's estimated reservation exceeds the remaining job budget. Review or raise the USD budget; progress is kept.",
          );
        if (
          data.states.flatMap((s) => s.attempts).filter((a) => !a.reusedFrom).length >=
          settings.maxRequests
        )
          return pause(
            "The request safeguard was reached. Review the recording and raise the request limit deliberately.",
          );
        const blob = await loadAsset(crop.assetId);
        if (!blob)
          throw new SlideFailure(
            "Evidence images are missing or evicted. Re-select the original recording and regenerate the representative frame.",
            "evidence_missing",
          );
        if ((await imageHash(blob)) !== crop.hash)
          throw new SlideFailure(
            "Evidence content no longer matches its saved hash. Regenerate and review the source before a paid request.",
            "evidence_mismatch",
          );
        let retryCount = 0;
        while (true) {
          checkAbort(signal);
          await options.leaseCheck?.();
          const attempt: Attempt = {
            id: crypto.randomUUID(),
            operationKey: key,
            cropId: crop.id,
            model: profile.model,
            profile: profile.id,
            promptVersion: PROMPT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            detail: profile.detail,
            outcome: "unknown-billing",
            at: Date.now(),
            reservedUsd: estimate,
            error: {
              code: "dispatch_pending",
              message:
                "A dispatch was recorded; its billing outcome is unknown until a response is saved.",
              billing: "unknown",
            },
          };
          state.attempts.push(attempt);
          state.status = "unknown-billing";
          await save(job);
          const result = await provider.extract({
            stateId: state.id,
            crop,
            blob,
            profile,
            operationKey: key,
            signal,
          });
          if (result.usage) {
            attempt.usage = result.usage;
            attempt.costUsd = usageCost(result.usage, profile.pricing);
          }
          attempt.requestId = result.ok ? result.requestId : result.error.requestId;
          if (result.ok) {
            attempt.outcome = "completed";
            attempt.extraction = result.extraction;
            delete attempt.error;
            cache.set(key, attempt);
            state.acceptedAttemptIds ??= {};
            if (!state.acceptedAttemptIds[crop.id]) state.acceptedAttemptIds[crop.id] = attempt.id;
            else if (retry)
              state.note =
                "A new extraction is available in the immutable comparison. The accepted source and manual edits were kept; choose a version deliberately.";
            if (result.extraction.unreadable.length || result.extraction.status === "unreadable")
              state.flags = [...new Set([...state.flags, "unreadable" as const])];
            if (result.extraction.flags.length)
              state.note = "Provider review flags are available in the raw extraction.";
          } else {
            attempt.error = result.error;
            attempt.partialText = result.partialText;
            attempt.outcome =
              result.error.billing === "unknown"
                ? "unknown-billing"
                : result.error.code === "incomplete"
                  ? "incomplete"
                  : "failed";
            state.status = attempt.outcome;
            state.flags = [...new Set([...state.flags, "incomplete" as const])];
            data.unknownBilling = data.states
              .flatMap((s) => s.attempts)
              .filter((a) => a.error?.billing === "unknown").length;
          }
          await save(job);
          if (signal.aborted) {
            data.status = "cancelled";
            data.error =
              "Processing cancelled. Accepted provider requests may still be billed; completed checkpoints are retained.";
            await save(job);
            return job;
          }
          if (result.ok) break;
          if (
            result.error.retryable &&
            result.error.billing === "none" &&
            retryCount++ < settings.retryAllowance
          ) {
            if (
              data.states.flatMap((s) => s.attempts).filter((a) => !a.reusedFrom).length >=
                settings.maxRequests ||
              knownCost(data.states) + unknownReserve(job) + estimate > settings.budgetUsd
            )
              return pause("Retry safeguard/budget reached. Review before another request.");
            const ms = Math.min(30_000, (result.error.retryAfterSec ?? 2) * 1000);
            await new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer);
                reject(new SlideFailure("Stopped during rate-limit backoff.", "cancelled"));
              };
              const timer = setTimeout(() => {
                signal.removeEventListener("abort", abort);
                resolve();
              }, ms);
              signal.addEventListener("abort", abort, { once: true });
            });
            continue;
          }
          return pause(result.error.message);
        }
        done++;
        options.onProgress?.(done, total);
      }
      state.status = "completed";
      state.flags = state.flags.filter((f) => f !== "incomplete");
      await save(job);
    }
    data.status =
      data.scanComplete &&
      data.states.every((s) => s.status === "completed" || s.status === "excluded")
        ? "completed"
        : "review";
    if (!data.scanComplete)
      data.error =
        "The approved pilot is complete; the remaining video still needs scanning/review.";
    await save(job);
    return job;
  } catch (error) {
    data.status = signal.aborted ? "cancelled" : "failed";
    data.error = error instanceof Error ? error.message : "Extraction stopped.";
    await save(job);
    throw error;
  }
}
