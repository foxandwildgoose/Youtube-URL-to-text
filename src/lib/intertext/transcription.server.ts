import { createHash, timingSafeEqual } from "node:crypto";
import type { ContentMode, MediaError, UploadLanguage } from "./media-types.ts";
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  MAX_CHUNK_BYTES,
  MAX_KEYWORDS,
  MAX_KEYWORD_CHARS,
  MAX_PROMPT_CHARS,
  MAX_TRANSCRIPTION_REQUEST_BYTES,
  MIN_ACCESS_TOKEN_CHARS,
  PREVIOUS_CONTEXT_CHARS,
  type TranscriptionConfiguration,
  type TranscriptionResponse,
} from "./transcription-contract.ts";

const MAX_METADATA_BYTES = 12_000;
const PROVIDER_TIMEOUT_MS = 55_000;
const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const MODELS = new Set([
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
  "whisper-1",
]);
const CONTENT_MODES: ContentMode[] = [
  "speech",
  "meeting",
  "interview",
  "lecture",
  "podcast",
  "ai-conference",
  "lyrics",
];
const LANGUAGES: UploadLanguage[] = ["auto", "ko-en", "ko", "en"];
const MIME_FORMATS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

type ServerEnvironment = Partial<
  Record<"OPENAI_API_KEY" | "OPENAI_TRANSCRIPTION_MODEL" | "TRANSCRIPTION_ACCESS_TOKEN", string>
>;
type Metadata = {
  chunk: {
    id: string;
    index: number;
    start: number;
    end: number;
    coreStart: number;
    coreEnd: number;
  };
  language: UploadLanguage;
  contentMode: ContentMode;
  keywords: string[];
  prompt: string;
  previousContext: string;
};

class RequestFailure extends Error {
  readonly status: number;
  readonly error: MediaError;
  constructor(status: number, error: MediaError) {
    super(error.message);
    this.status = status;
    this.error = error;
  }
}

function json(body: TranscriptionResponse | TranscriptionConfiguration, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export function getTranscriptionConfiguration(
  environment: ServerEnvironment = process.env,
): TranscriptionConfiguration {
  const model = environment.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
  const keyPresent = Boolean(environment.OPENAI_API_KEY?.trim());
  const tokenPresent =
    (environment.TRANSCRIPTION_ACCESS_TOKEN?.trim().length ?? 0) >= MIN_ACCESS_TOKEN_CHARS;
  const configured = keyPresent && tokenPresent && MODELS.has(model);
  const message = !keyPresent
    ? "File transcription is unavailable because OPENAI_API_KEY is not configured on the server."
    : !tokenPresent
      ? `File transcription needs a server TRANSCRIPTION_ACCESS_TOKEN containing at least ${MIN_ACCESS_TOKEN_CHARS} characters to protect your API account.`
      : !MODELS.has(model)
        ? "The configured transcription model is unsupported. Use a documented file transcription model."
        : undefined;
  return {
    configured,
    model: MODELS.has(model) ? model : DEFAULT_TRANSCRIPTION_MODEL,
    requiresAccessToken: true,
    ...(message ? { message } : {}),
  };
}

export function handleTranscriptionConfiguration(
  environment: ServerEnvironment = process.env,
): Response {
  return json(getTranscriptionConfiguration(environment));
}

function authorize(request: Request, environment: ServerEnvironment): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!origin || origin !== new URL(request.url).origin || (site && site !== "same-origin")) {
    throw new RequestFailure(403, {
      code: "provider_auth_failed",
      message: "File transcription requires a request from this workspace.",
    });
  }
  const supplied = request.headers.get("x-intertext-access-token") ?? "";
  const expected = environment.TRANSCRIPTION_ACCESS_TOKEN?.trim() ?? "";
  // Compare fixed-length hashes so token length and prefix cannot leak through timing.
  if (
    supplied.length > 1_024 ||
    !timingSafeEqual(
      createHash("sha256").update(supplied).digest(),
      createHash("sha256").update(expected).digest(),
    )
  ) {
    throw new RequestFailure(401, {
      code: "provider_auth_failed",
      message: "Enter the correct personal access code under Advanced Options.",
    });
  }
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLarge: RequestFailure,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream)
    throw new RequestFailure(400, {
      code: "unsupported_file",
      message: "The audio request is empty.",
    });
  const reader = stream.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge;
      }
      pieces.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.byteLength;
  }
  return bytes;
}

function validateMetadata(value: unknown): Metadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestFailure(400, {
      code: "transcription_failed",
      message: "Invalid transcription settings.",
    });
  const data = value as Record<string, unknown>;
  const chunk = data.chunk as Record<string, unknown> | undefined;
  const finite = (number: unknown): number is number =>
    typeof number === "number" && Number.isFinite(number) && number >= 0;
  if (
    !chunk ||
    typeof chunk.id !== "string" ||
    chunk.id.length > 128 ||
    !Number.isInteger(chunk.index) ||
    !finite(chunk.index) ||
    chunk.index > 10_000 ||
    !finite(chunk.start) ||
    !finite(chunk.end) ||
    !finite(chunk.coreStart) ||
    !finite(chunk.coreEnd) ||
    chunk.start > chunk.coreStart ||
    chunk.coreStart >= chunk.coreEnd ||
    chunk.coreEnd > chunk.end ||
    chunk.end > 86_400 ||
    chunk.end - chunk.start > 900
  ) {
    throw new RequestFailure(400, {
      code: "transcription_failed",
      message: "Invalid audio section offsets.",
    });
  }
  if (
    !LANGUAGES.includes(data.language as UploadLanguage) ||
    !CONTENT_MODES.includes(data.contentMode as ContentMode)
  )
    throw new RequestFailure(400, {
      code: "transcription_failed",
      message: "Invalid language or content mode.",
    });
  if (
    !Array.isArray(data.keywords) ||
    data.keywords.length > MAX_KEYWORDS ||
    data.keywords.some(
      (term) =>
        typeof term !== "string" ||
        term.length > MAX_KEYWORD_CHARS ||
        !term.trim() ||
        [...term].some((character) => character.charCodeAt(0) < 32),
    )
  )
    throw new RequestFailure(400, {
      code: "transcription_failed",
      message: `Use up to ${MAX_KEYWORDS} technical terms, each up to ${MAX_KEYWORD_CHARS} characters.`,
    });
  if (
    typeof data.prompt !== "string" ||
    data.prompt.length > MAX_PROMPT_CHARS ||
    typeof data.previousContext !== "string" ||
    data.previousContext.length > PREVIOUS_CONTEXT_CHARS
  )
    throw new RequestFailure(400, {
      code: "transcription_failed",
      message: "Transcription context is too long.",
    });
  return {
    chunk: chunk as Metadata["chunk"],
    language: data.language as UploadLanguage,
    contentMode: data.contentMode as ContentMode,
    keywords: data.keywords.map((term: string) => term.trim()),
    prompt: data.prompt.trim(),
    previousContext: data.previousContext,
  };
}

function hasSignature(bytes: Uint8Array, format: string): boolean {
  const prefix = (text: string, offset = 0) =>
    [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  switch (format) {
    case "mp3":
      return (
        prefix("ID3") ||
        (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 && (bytes[1]! & 0x06) !== 0)
      );
    case "wav":
      return prefix("RIFF") && prefix("WAVE", 8);
    case "m4a":
      return prefix("ftyp", 4);
    case "webm":
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "ogg":
      return prefix("OggS");
    case "flac":
      return prefix("fLaC");
    default:
      return false;
  }
}

function buildPrompt(metadata: Metadata, nativeHints: boolean): string {
  const parts: string[] = [];
  if (metadata.contentMode === "ai-conference")
    parts.push(
      "AI, semiconductor, software and technology conference. Speakers switch between Korean and English. Preserve spoken English company, product, model, hardware and API names, acronyms and technical expressions in conventional English spelling. Transcribe only what is spoken; do not invent missing terms.",
    );
  if (metadata.language === "ko-en")
    parts.push(
      "한국어와 English가 함께 나오는 녹음입니다. Preserve both languages as spoken; do not translate.",
    );
  if (!nativeHints && metadata.keywords.length)
    parts.push(`Relevant vocabulary: ${metadata.keywords.join(", ")}.`);
  if (metadata.prompt) parts.push(metadata.prompt);
  if (metadata.previousContext)
    parts.push(
      `Previous audio context (do not repeat unless spoken again): ${metadata.previousContext}`,
    );
  return parts.join("\n\n");
}

function providerFailure(status: number): RequestFailure {
  if (status === 401 || status === 403)
    return new RequestFailure(502, {
      code: "provider_auth_failed",
      message:
        "The configured API account could not authorize transcription. Check its server key and model access.",
    });
  if (status === 429)
    return new RequestFailure(429, {
      code: "provider_rate_limited",
      message:
        "The transcription provider is rate-limited or its API quota is exhausted. Check API billing and retry later.",
      retryable: true,
    });
  if (status === 413)
    return new RequestFailure(413, {
      code: "chunk_too_large",
      message: "The provider rejected the prepared audio size.",
    });
  return new RequestFailure(502, {
    code: "transcription_failed",
    message:
      status >= 500
        ? "The transcription provider is temporarily unavailable. Retry to continue from the saved sections."
        : "The transcription provider rejected this audio section or model configuration.",
    retryable: status >= 500,
  });
}

/** One bounded audio upload, no disk storage, no database, no key in browser code. */
export async function handleTranscriptionRequest(
  request: Request,
  dependencies: { environment?: ServerEnvironment; fetch?: typeof fetch } = {},
): Promise<Response> {
  const environment = dependencies.environment ?? process.env;
  const fetchProvider = dependencies.fetch ?? fetch;
  try {
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    const configuration = getTranscriptionConfiguration(environment);
    if (!configuration.configured)
      throw new RequestFailure(503, {
        code: "not_configured",
        message: configuration.message ?? "File transcription is not configured.",
      });
    authorize(request, environment);
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType))
      throw new RequestFailure(415, {
        code: "unsupported_file",
        message: "Send one prepared audio section using multipart form data.",
      });
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_TRANSCRIPTION_REQUEST_BYTES))
      throw new RequestFailure(413, {
        code: "chunk_too_large",
        message: "The audio request exceeds the safe upload limit.",
      });
    const bytes = await readBounded(
      request.body,
      MAX_TRANSCRIPTION_REQUEST_BYTES,
      new RequestFailure(413, {
        code: "chunk_too_large",
        message: "The audio request exceeds the safe upload limit.",
      }),
    );
    let form: FormData;
    try {
      form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    } catch {
      throw new RequestFailure(400, {
        code: "unsupported_file",
        message: "The audio form could not be read.",
      });
    }
    if (
      form.getAll("file").length !== 1 ||
      form.getAll("metadata").length !== 1 ||
      [...form.keys()].some((key) => key !== "file" && key !== "metadata")
    )
      throw new RequestFailure(400, {
        code: "unsupported_file",
        message: "Send exactly one prepared audio section and its settings.",
      });
    const file = form.get("file");
    const metadataString = form.get("metadata");
    if (
      !(file instanceof File) ||
      typeof metadataString !== "string" ||
      new TextEncoder().encode(metadataString).byteLength > MAX_METADATA_BYTES
    )
      throw new RequestFailure(400, {
        code: "unsupported_file",
        message: "Missing audio or invalid settings.",
      });
    if (file.size === 0 || file.size > MAX_CHUNK_BYTES)
      throw new RequestFailure(413, {
        code: "chunk_too_large",
        message: "The prepared audio must be nonempty and below the safe section size.",
      });
    const format = MIME_FORMATS[file.type.toLowerCase()];
    if (!format || !hasSignature(new Uint8Array(await file.slice(0, 16).arrayBuffer()), format))
      throw new RequestFailure(415, {
        code: "unsupported_file",
        message: "The prepared file is not a supported audio format.",
      });
    let metadata: Metadata;
    try {
      metadata = validateMetadata(JSON.parse(metadataString));
    } catch (error) {
      if (error instanceof RequestFailure) throw error;
      throw new RequestFailure(400, {
        code: "transcription_failed",
        message: "Invalid transcription settings.",
      });
    }
    const nativeHints = configuration.model === DEFAULT_TRANSCRIPTION_MODEL;
    const body = new FormData();
    body.append("file", file, `audio-section.${format}`);
    body.append("model", configuration.model);
    body.append("response_format", "json");
    if (nativeHints) {
      const hints =
        metadata.language === "ko-en"
          ? ["ko", "en"]
          : metadata.language === "auto"
            ? []
            : [metadata.language];
      for (const language of hints) body.append("languages[]", language);
      for (const keyword of metadata.keywords) body.append("keywords[]", keyword);
    } else if (metadata.language === "ko" || metadata.language === "en")
      body.append("language", metadata.language);
    const prompt = buildPrompt(metadata, nativeHints);
    if (prompt) body.append("prompt", prompt);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]);
    let provider: Response;
    try {
      provider = await fetchProvider("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${environment.OPENAI_API_KEY!.trim()}` },
        body,
        signal,
      });
    } catch {
      if (request.signal.aborted)
        throw new RequestFailure(499, { code: "cancelled", message: "Transcription cancelled." });
      throw new RequestFailure(504, {
        code: "network",
        message:
          "The transcription provider timed out or could not be reached. Retry to continue from saved sections.",
        retryable: true,
      });
    }
    if (!provider.ok) {
      await provider.body?.cancel();
      throw providerFailure(provider.status);
    }
    const providerBytes = await readBounded(
      provider.body,
      MAX_PROVIDER_RESPONSE_BYTES,
      new RequestFailure(502, {
        code: "transcription_failed",
        message: "The transcription provider returned too much data.",
      }),
    );
    let result: { text?: unknown; languages?: unknown; language?: unknown };
    try {
      result = JSON.parse(new TextDecoder().decode(providerBytes)) as typeof result;
    } catch {
      throw new RequestFailure(502, {
        code: "transcription_failed",
        message: "The transcription provider returned unreadable data.",
        retryable: true,
      });
    }
    if (typeof result.text !== "string")
      throw new RequestFailure(502, {
        code: "transcription_failed",
        message: "The transcription provider returned no transcript.",
        retryable: true,
      });
    const detectedLanguages = Array.isArray(result.languages)
      ? result.languages.flatMap((language: unknown) => {
          const code =
            typeof language === "string"
              ? language
              : language && typeof language === "object" && "code" in language
                ? (language as { code: unknown }).code
                : undefined;
          return typeof code === "string" && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(code)
            ? [code]
            : [];
        })
      : [];
    const language =
      detectedLanguages.join(", ") ||
      (typeof result.language === "string" && /^[a-z]{2,3}$/.test(result.language)
        ? result.language
        : undefined);
    return json({
      ok: true,
      transcript: {
        text: result.text,
        ...(language ? { language } : {}),
        timestampQuality: "chunk-estimated",
      },
    });
  } catch (error) {
    if (error instanceof RequestFailure)
      return json({ ok: false, error: error.error }, error.status);
    if (request.signal.aborted)
      return json(
        { ok: false, error: { code: "cancelled", message: "Transcription cancelled." } },
        499,
      );
    return json(
      {
        ok: false,
        error: {
          code: "transcription_failed",
          message:
            "The audio section could not be transcribed. Retry to continue from saved sections.",
          retryable: true,
        },
      },
      500,
    );
  }
}
