import type { MediaError, MediaErrorCode } from "./media-types.ts";

export class MediaPipelineError extends Error {
  readonly code: MediaErrorCode;
  readonly details?: string;
  readonly retryable: boolean;
  constructor(code: MediaErrorCode, message: string, details?: string, retryable = false) {
    super(message);
    this.name = "MediaPipelineError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new MediaPipelineError(
      "cancelled",
      "Transcription was cancelled. Completed sections are saved.",
    );
}

export function toMediaError(error: unknown, signal?: AbortSignal): MediaError {
  if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
    return {
      code: "cancelled",
      message: "Transcription was cancelled. Completed sections are saved.",
    };
  }
  if (error instanceof MediaPipelineError)
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      retryable: error.retryable,
    };
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const typed = error as MediaError;
    // Provider errors may extend Error; checkpoints/backup must contain JSON data.
    return {
      code: typed.code,
      message: typed.message,
      details: typed.details,
      retryable: typed.retryable,
    };
  }
  return {
    code: "transcription_failed",
    message: "Transcription could not finish. Your completed sections are saved.",
    details: error instanceof Error ? error.message : "Unexpected processing error",
  };
}
