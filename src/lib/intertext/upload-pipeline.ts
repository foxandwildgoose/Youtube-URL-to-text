import { createChunkPlan, splitOversizedChunk } from "./media-chunks.ts";
import { TRANSCRIPTION_CONFIG } from "./media-config.ts";
import { MediaPipelineError, throwIfAborted, toMediaError } from "./media-errors.ts";
import { fingerprintMedia, validateMedia } from "./media-inspect.ts";
import { mergeChunkTranscripts } from "./media-merge.ts";
import type { MediaProcessor } from "./media-processor.ts";
import type { Job } from "./types.ts";
import type {
  AudioChunk,
  ChunkCheckpoint,
  JobStatus,
  ProviderTranscript,
  UploadRunOptions,
} from "./media-types.ts";

export type MediaProcessorFactory = (file: File, signal: AbortSignal) => Promise<MediaProcessor>;

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(
        new MediaPipelineError(
          "cancelled",
          "Transcription was cancelled. Completed sections are saved.",
        ),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function transcribeWithRetry(
  chunk: AudioChunk,
  options: UploadRunOptions,
  previousContext: string,
  settings: NonNullable<Job["upload"]>["settings"],
  completed: number,
  total: number,
): Promise<ProviderTranscript> {
  const config = TRANSCRIPTION_CONFIG.retry;
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(options.signal);
    try {
      const transcript = await options.provider.transcribeChunk(chunk, {
        ...settings,
        previousContext,
        signal: options.signal,
      });
      throwIfAborted(options.signal);
      if (!transcript.text.trim())
        throw new MediaPipelineError(
          "transcription_failed",
          "The transcription provider returned no text for this section. Retry this section to avoid missing speech.",
        );
      return transcript;
    } catch (error) {
      const normalized = toMediaError(error, options.signal);
      const transient =
        normalized.code === "network" ||
        normalized.code === "provider_rate_limited" ||
        (normalized.code === "transcription_failed" && normalized.retryable === true);
      if (!transient || attempt >= config.maximumRetries)
        throw new MediaPipelineError(
          normalized.code,
          normalized.message,
          normalized.details,
          normalized.retryable,
        );
      const delay =
        Math.min(config.maximumDelayMs, config.initialDelayMs * 2 ** attempt) *
        (0.85 + Math.random() * 0.3);
      options.onProgress({
        status: "transcribing",
        completed,
        total,
        message: `Connection interrupted. Retrying this section (${attempt + 1}/${config.maximumRetries})…`,
      });
      await abortableDelay(delay, options.signal);
    }
  }
}

export async function runUpload(options: UploadRunOptions): Promise<Job> {
  return runUploadWithProcessor(options, async (file, signal) => {
    const { createMediaProcessor } = await import("./media-processor.ts");
    return createMediaProcessor(file, signal);
  });
}

/** Explicit seam for deterministic, unpaid processor/provider tests. */
export async function runUploadWithProcessor(
  options: UploadRunOptions,
  processorFactory: MediaProcessorFactory,
): Promise<Job> {
  const { file, signal, onProgress } = options;
  let job: Job = {
    ...options.job,
    upload: options.job.upload
      ? {
          ...options.job.upload,
          chunks: [...options.job.upload.chunks],
          plan: [...options.job.upload.plan],
        }
      : undefined,
  };
  let processor: MediaProcessor | undefined;

  const persist = async () => {
    try {
      await options.save(job);
    } catch (error) {
      throw new MediaPipelineError(
        "storage_quota",
        "Browser history could not save this checkpoint. Free browser storage and retry; keep this tab open to preserve the current result.",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const stage = async (status: JobStatus, message: string, completed = 0, total = 0) => {
    job.upload!.status = status;
    onProgress({ status, message, completed, total });
    await persist();
  };

  try {
    if (!job.upload || job.source?.kind !== "upload")
      throw new MediaPipelineError("unsupported_file", "This job is not an uploaded recording.");
    validateMedia(file);
    throwIfAborted(signal);
    const fingerprint = await fingerprintMedia(file, signal);
    if (fingerprint !== job.source.fingerprint)
      throw new MediaPipelineError(
        "resume_file_mismatch",
        "Choose the original recording for this job. Its name, size, modification time, or content does not match.",
      );
    if (!Number.isFinite(job.durationSec) || job.durationSec <= 0)
      throw new MediaPipelineError(
        "media_decode_failed",
        "The recording duration is unavailable. Select the file again.",
      );
    if (job.durationSec > TRANSCRIPTION_CONFIG.limits.maxDurationSec)
      throw new MediaPipelineError(
        "duration_too_long",
        "This recording exceeds the two-hour admission limit.",
      );
    delete job.upload.error;
    await stage("preparing", "Preparing media…");
    const pending = job.upload.plan.filter(
      (plan) => !job.upload!.chunks.some((checkpoint) => checkpoint.id === plan.id),
    );
    // A fully checkpointed job can rebuild its transcript without media decoding.
    if (!job.upload.plan.length || pending.length) {
      await stage("extracting-audio", "Starting local audio processing…");
      processor = await processorFactory(file, signal);
      if (!job.upload.plan.length) {
        await stage("analyzing-boundaries", "Finding safe boundaries…");
        let silences: Awaited<ReturnType<MediaProcessor["findSilences"]>> = [];
        try {
          silences = await processor.findSilences(job.durationSec, (completed, total) =>
            onProgress({
              status: "analyzing-boundaries",
              completed,
              total,
              message: "Finding safe boundaries…",
            }),
          );
        } catch {
          throwIfAborted(signal); /* silence is optional; fixed cuts retain overlap */
        }
        job.upload.plan = createChunkPlan(job.durationSec, silences);
        await persist();
      }
    }
    let index = 0;
    while (index < job.upload.plan.length) {
      throwIfAborted(signal);
      const plan = job.upload.plan[index]!;
      if (job.upload.chunks.some((checkpoint) => checkpoint.id === plan.id)) {
        index++;
        continue;
      }
      await stage(
        "chunking",
        "Preparing the next audio section…",
        job.upload.chunks.length,
        job.upload.plan.length,
      );
      let chunk: AudioChunk | undefined = await processor!.encodeChunk(plan);
      throwIfAborted(signal);
      if (chunk.blob.size > TRANSCRIPTION_CONFIG.chunking.targetMaxPayloadBytes) {
        const replacement = splitOversizedChunk(plan, chunk.blob.size, job.durationSec);
        if (!replacement.length)
          throw new MediaPipelineError(
            "chunk_too_large",
            "This audio section could not be reduced below the safe upload limit.",
          );
        chunk = undefined;
        job.upload.plan.splice(index, 1, ...replacement);
        job.upload.plan = job.upload.plan.map((entry, position) => ({ ...entry, index: position }));
        await persist();
        continue;
      }
      if (chunk.blob.size > TRANSCRIPTION_CONFIG.chunking.hardMaxPayloadBytes)
        throw new MediaPipelineError(
          "chunk_too_large",
          "The audio section exceeds the safe upload limit.",
        );
      await stage(
        "transcribing",
        "Transcribing…",
        job.upload.chunks.length,
        job.upload.plan.length,
      );
      const previous = [...job.upload.chunks]
        .filter((checkpoint) => checkpoint.coreEnd <= plan.coreStart + 0.05)
        .sort((a, b) => a.coreEnd - b.coreEnd)
        .at(-1);
      const previousContext =
        previous?.transcript.text.slice(-TRANSCRIPTION_CONFIG.context.previousChunkChars) ?? "";
      const transcript = await transcribeWithRetry(
        chunk,
        options,
        previousContext,
        job.upload.settings,
        job.upload.chunks.length,
        job.upload.plan.length,
      );
      const checkpoint: ChunkCheckpoint = {
        ...plan,
        transcript,
        completedAt: Date.now(),
        sizeBytes: chunk.blob.size,
      };
      job.upload.chunks.push(checkpoint);
      // Preserve raw output before encoding or paying for another section.
      await persist();
      chunk = undefined;
      index++;
      onProgress({
        status: "transcribing",
        completed: job.upload.chunks.length,
        total: job.upload.plan.length,
        message: "Transcribing…",
      });
    }
    throwIfAborted(signal);
    await stage("merging", "Merging transcript…", job.upload.chunks.length, job.upload.plan.length);
    const merged = mergeChunkTranscripts(job.upload.chunks, job.upload.settings.contentMode);
    const paragraphs = merged.paragraphs.map((paragraph) => ({
      ...paragraph,
      ...job.paragraphEdits?.[String(paragraph.start)],
    }));
    const segments = paragraphs.map((paragraph) => ({ ...paragraph }));
    job = {
      ...job,
      segments,
      paragraphs,
      segmentCount: segments.length,
      timestampQuality: "chunk-estimated",
      upload: { ...job.upload, status: "completed", mergeAudit: merged.audit },
    };
    await persist();
    onProgress({
      status: "completed",
      completed: job.upload!.chunks.length,
      total: job.upload!.plan.length,
      message: "Transcript ready.",
    });
    return job;
  } catch (error) {
    const normalized = toMediaError(error, signal);
    if (job.upload) {
      job.upload = {
        ...job.upload,
        status: normalized.code === "cancelled" ? "cancelled" : "failed",
        error: normalized,
      };
      const partial = mergeChunkTranscripts(job.upload.chunks, job.upload.settings.contentMode);
      const paragraphs = partial.paragraphs.map((paragraph) => ({
        ...paragraph,
        ...job.paragraphEdits?.[String(paragraph.start)],
      }));
      job = {
        ...job,
        segments: paragraphs.map((paragraph) => ({ ...paragraph })),
        paragraphs,
        segmentCount: paragraphs.length,
        timestampQuality: "chunk-estimated",
      };
      try {
        await persist();
      } catch {
        /* preserve the original error and in-memory checkpoints */
      }
      onProgress({
        status: job.upload!.status,
        completed: job.upload!.chunks.length,
        total: job.upload!.plan.length,
        message: normalized.message,
      });
    }
    throw new MediaPipelineError(
      normalized.code,
      normalized.message,
      normalized.details,
      normalized.retryable,
    );
  } finally {
    await processor?.close();
  }
}
