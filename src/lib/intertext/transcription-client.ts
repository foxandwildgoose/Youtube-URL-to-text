import type {
  AudioChunk,
  MediaError,
  ProviderTranscript,
  TranscriptionOptions,
  TranscriptionProvider,
} from "./media-types.ts";
import {
  MAX_CHUNK_BYTES,
  MAX_TRANSCRIPTION_REQUEST_BYTES,
  PREVIOUS_CONTEXT_CHARS,
  type TranscriptionConfiguration,
  type TranscriptionResponse,
} from "./transcription-contract.ts";

export class TranscriptionClientError extends Error {
  readonly code: MediaError["code"];
  readonly retryable?: boolean;
  readonly details?: string;

  constructor(error: MediaError) {
    super(error.message);
    this.name = "TranscriptionClientError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

/** This reports safe configuration status; API keys and access codes never return. */
export async function checkTranscriptionConfiguration(): Promise<TranscriptionConfiguration> {
  const response = await fetch("/api/transcription-config", {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new TranscriptionClientError({
      code: "network",
      message: "Could not check file transcription configuration.",
      retryable: true,
    });
  }
  return response.json() as Promise<TranscriptionConfiguration>;
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  // Held in memory only. The UI must not persist this code with job settings.
  private readonly accessToken: string;
  constructor(accessToken = "") {
    this.accessToken = accessToken;
  }

  async transcribeChunk(
    chunk: AudioChunk,
    options: TranscriptionOptions,
  ): Promise<ProviderTranscript> {
    if (options.signal?.aborted)
      throw new TranscriptionClientError({
        code: "cancelled",
        message: "Transcription cancelled.",
      });
    if (chunk.blob.size > MAX_CHUNK_BYTES) {
      throw new TranscriptionClientError({
        code: "chunk_too_large",
        message:
          "The prepared audio is too large. Prepare a smaller audio section before retrying.",
      });
    }
    const form = new FormData();
    // The original media file is never included in this request.
    form.append("file", chunk.blob, chunk.fileName);
    form.append(
      "metadata",
      JSON.stringify({
        chunk: {
          id: chunk.id,
          index: chunk.index,
          start: chunk.start,
          end: chunk.end,
          coreStart: chunk.coreStart,
          coreEnd: chunk.coreEnd,
        },
        language: options.language,
        contentMode: options.contentMode,
        keywords: options.keywords,
        prompt: options.prompt ?? "",
        previousContext: (options.previousContext ?? "").slice(-PREVIOUS_CONTEXT_CHARS),
      }),
    );
    // Measure the exact bytes sent, including UTF-8 metadata and multipart
    // boundaries. Measuring only the audio misses the deployment's body limit.
    const serialized = new Response(form);
    const payload = await serialized.blob();
    if (payload.size > MAX_TRANSCRIPTION_REQUEST_BYTES) {
      throw new TranscriptionClientError({
        code: "chunk_too_large",
        message:
          "The complete audio request exceeds the safe upload limit. Reduce the audio section or transcription context before retrying.",
      });
    }
    if (options.signal?.aborted)
      throw new TranscriptionClientError({
        code: "cancelled",
        message: "Transcription cancelled.",
      });
    let response: Response;
    try {
      response = await fetch("/api/transcription", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-intertext-access-token": this.accessToken,
          "content-type": serialized.headers.get("content-type")!,
        },
        body: payload,
        signal: options.signal,
      });
    } catch {
      if (options.signal?.aborted)
        throw new TranscriptionClientError({
          code: "cancelled",
          message: "Transcription cancelled.",
        });
      throw new TranscriptionClientError({
        code: "network",
        message:
          "The transcription connection failed. Your completed sections are saved; retry to continue.",
        retryable: true,
      });
    }
    let result: TranscriptionResponse;
    try {
      result = (await response.json()) as TranscriptionResponse;
    } catch {
      throw new TranscriptionClientError({
        code: response.status === 413 ? "chunk_too_large" : "transcription_failed",
        message:
          response.status === 413
            ? "The audio request exceeded the deployment upload limit."
            : "The transcription server returned an unreadable response.",
        retryable: response.status >= 500,
      });
    }
    if (!result.ok) {
      if (
        !result.error ||
        typeof result.error.message !== "string" ||
        typeof result.error.code !== "string"
      ) {
        throw new TranscriptionClientError({
          code: "transcription_failed",
          message: "The transcription server returned an invalid response.",
          retryable: response.status >= 500,
        });
      }
      throw new TranscriptionClientError(result.error);
    }
    if (!response.ok || typeof result.transcript?.text !== "string") {
      throw new TranscriptionClientError({
        code: "transcription_failed",
        message: "The transcription server returned an invalid response.",
        retryable: true,
      });
    }
    return result.transcript;
  }
}
