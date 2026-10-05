import type { MediaError, ProviderTranscript } from "./media-types.ts";

// Keep multipart metadata comfortably below Vercel's documented 4.5 MB ceiling.
export const MAX_CHUNK_BYTES = 3_000_000;
export const MAX_TRANSCRIPTION_REQUEST_BYTES = 3_500_000;
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";
export const PREVIOUS_CONTEXT_CHARS = 400;
export const MAX_KEYWORDS = 80;
export const MAX_KEYWORD_CHARS = 80;
export const MAX_PROMPT_CHARS = 1_200;
export const MIN_ACCESS_TOKEN_CHARS = 24;

export type TranscriptionConfiguration = {
  configured: boolean;
  model: string;
  requiresAccessToken: boolean;
  message?: string;
};

export type TranscriptionResponse =
  { ok: true; transcript: ProviderTranscript } | { ok: false; error: MediaError };
