import type { Job } from "./types.ts";

export type MediaSource =
  | { kind: "youtube"; videoId: string; url: string }
  | {
      kind: "upload";
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      lastModified: number;
      fingerprint: string;
    };
export type ContentMode =
  "speech" | "meeting" | "interview" | "lecture" | "podcast" | "ai-conference" | "lyrics";
export type UploadLanguage = "ko-en" | "ko" | "en" | "auto";
export type JobStatus =
  | "idle"
  | "inspecting"
  | "preparing"
  | "extracting-audio"
  | "analyzing-boundaries"
  | "chunking"
  | "transcribing"
  | "merging"
  | "postprocessing"
  | "completed"
  | "cancelled"
  | "failed";
export type TimestampQuality = "source" | "provider" | "chunk-estimated" | "none";
export type MediaErrorCode =
  | "unsupported_file"
  | "file_too_large"
  | "duration_too_long"
  | "media_decode_failed"
  | "audio_extract_failed"
  | "audio_encode_failed"
  | "silence_analysis_failed"
  | "chunk_generation_failed"
  | "chunk_too_large"
  | "transcription_failed"
  | "provider_rate_limited"
  | "provider_auth_failed"
  | "network"
  | "cancelled"
  | "storage_quota"
  | "resume_file_mismatch"
  | "not_configured";
export type MediaError = {
  code: MediaErrorCode;
  message: string;
  details?: string;
  retryable?: boolean;
};
export type UploadSettings = {
  language: UploadLanguage;
  contentMode: ContentMode;
  keywords: string[];
  prompt?: string;
};
export type ChunkPlan = {
  id: string;
  index: number;
  coreStart: number;
  coreEnd: number;
  start: number;
  end: number;
};
export type AudioChunk = ChunkPlan & { blob: Blob; mimeType: string; fileName: string };
export type ProviderTranscript = {
  text: string;
  language?: string;
  timestampQuality: TimestampQuality;
};
export type TranscriptionOptions = UploadSettings & {
  previousContext?: string;
  signal?: AbortSignal;
};
export interface TranscriptionProvider {
  transcribeChunk(chunk: AudioChunk, options: TranscriptionOptions): Promise<ProviderTranscript>;
}
export type ChunkCheckpoint = ChunkPlan & {
  transcript: ProviderTranscript;
  completedAt: number;
  sizeBytes: number;
};
export type MergeAudit = {
  previousChunkId: string;
  nextChunkId: string;
  similarity: number;
  removedTextLength: number;
  matchMethod: string;
  confidence: "high" | "possible" | "none";
};
export type UploadState = {
  status: JobStatus;
  settings: UploadSettings;
  chunks: ChunkCheckpoint[];
  plan: ChunkPlan[];
  mergeAudit?: MergeAudit[];
  error?: MediaError;
};
export type MediaProgress = {
  status: JobStatus;
  completed: number;
  total: number;
  message: string;
};
export type UploadRunOptions = {
  file: File;
  job: Job;
  provider: TranscriptionProvider;
  signal: AbortSignal;
  onProgress: (progress: MediaProgress) => void;
  save: (job: Job) => Promise<void>;
};
