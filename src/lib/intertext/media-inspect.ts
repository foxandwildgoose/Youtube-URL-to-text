import { TRANSCRIPTION_CONFIG } from "./media-config.ts";
import { MediaPipelineError, throwIfAborted } from "./media-errors.ts";

const FORMATS: Record<string, { mime: string[]; kind: "audio" | "video" }> = {
  mp4: { mime: ["video/mp4", "application/mp4"], kind: "video" },
  mov: { mime: ["video/quicktime", "video/mp4"], kind: "video" },
  webm: { mime: ["video/webm", "audio/webm"], kind: "video" },
  mpeg: { mime: ["video/mpeg", "audio/mpeg"], kind: "video" },
  mpg: { mime: ["video/mpeg"], kind: "video" },
  mpga: { mime: ["audio/mpeg"], kind: "audio" },
  mp3: { mime: ["audio/mpeg", "audio/mp3"], kind: "audio" },
  m4a: { mime: ["audio/mp4", "audio/x-m4a", "audio/m4a", "video/mp4"], kind: "audio" },
  wav: { mime: ["audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave"], kind: "audio" },
};

export type MediaMetadata = {
  durationSec: number;
  mimeType: string;
  fingerprint: string;
  kind: "audio" | "video";
};

export function validateMedia(file: File): void {
  const format = FORMATS[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (
    !format ||
    (file.type &&
      file.type !== "application/octet-stream" &&
      !format.mime.includes(file.type.toLowerCase()))
  )
    throw new MediaPipelineError(
      "unsupported_file",
      "Choose an MP4, MOV, WebM, MPEG, MP3, M4A, or WAV file with a matching media type.",
    );
  if (file.size === 0) throw new MediaPipelineError("unsupported_file", "This file is empty.");
  if (file.size > TRANSCRIPTION_CONFIG.limits.maxFileBytes)
    throw new MediaPipelineError(
      "file_too_large",
      "This file exceeds the 1.5 GB admission limit. Browser memory may impose a lower practical limit.",
    );
}

/** Sample both ends plus metadata; never read the entire large source into memory. */
export async function fingerprintMedia(file: File, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const size = TRANSCRIPTION_CONFIG.limits.fingerprintSampleBytes;
  const prefix = new TextEncoder().encode(`${file.name}\0${file.size}\0${file.lastModified}\0`);
  const first = new Uint8Array(await file.slice(0, size).arrayBuffer());
  const last = new Uint8Array(await file.slice(Math.max(size, file.size - size)).arrayBuffer());
  const sample = new Uint8Array(prefix.length + first.length + last.length);
  sample.set(prefix);
  sample.set(first, prefix.length);
  sample.set(last, prefix.length + first.length);
  throwIfAborted(signal);
  const digest = await crypto.subtle.digest("SHA-256", sample);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateHeader(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  const extension = file.name.split(".").pop()?.toLowerCase();
  let valid = false;
  if (extension === "mp4" || extension === "m4a" || extension === "mov")
    valid = ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(ascii(4, 4));
  if (extension === "webm")
    valid = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (extension === "wav") valid = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
  if (["mp3", "mpga", "mpeg", "mpg"].includes(extension ?? ""))
    valid =
      ascii(0, 3) === "ID3" ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) ||
      (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1);
  if (!valid)
    throw new MediaPipelineError(
      "unsupported_file",
      "The contents of this file do not match a supported media container.",
    );
}

function browserDuration(file: File, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("video");
    const url = URL.createObjectURL(file);
    const timer = setTimeout(
      () => finish(new Error("Media metadata timed out.")),
      TRANSCRIPTION_CONFIG.limits.metadataTimeoutMs,
    );
    const abort = () =>
      finish(new MediaPipelineError("cancelled", "Media inspection was cancelled."));
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      element.onloadedmetadata = null;
      element.onerror = null;
      const duration = element.duration;
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else if (!Number.isFinite(duration) || duration <= 0)
        reject(new Error("Media duration is not available."));
      else resolve(duration);
    };
    signal?.addEventListener("abort", abort, { once: true });
    element.preload = "metadata";
    element.onloadedmetadata = () => finish();
    element.onerror = () => finish(new Error("This browser cannot read this container."));
    element.src = url;
    if (signal?.aborted) abort();
  });
}

export async function inspectMedia(file: File, signal?: AbortSignal): Promise<MediaMetadata> {
  validateMedia(file);
  throwIfAborted(signal);
  await validateHeader(file);
  const fingerprint = await fingerprintMedia(file, signal);
  let durationSec: number;
  try {
    durationSec = await browserDuration(file, signal);
  } catch {
    throwIfAborted(signal);
    // MOV/MPEG and browser-incompatible codecs may still work through FFmpeg.
    const { createMediaProcessor } = await import("./media-processor.ts");
    const processor = await createMediaProcessor(file, signal);
    try {
      durationSec = await processor.probeDuration();
    } finally {
      await processor.close();
    }
  }
  if (durationSec > TRANSCRIPTION_CONFIG.limits.maxDurationSec)
    throw new MediaPipelineError(
      "duration_too_long",
      "This recording exceeds the two-hour admission limit.",
    );
  const format = FORMATS[file.name.split(".").pop()!.toLowerCase()]!;
  return {
    durationSec,
    fingerprint,
    mimeType: file.type || format.mime[0]!,
    kind: file.type.startsWith("audio/") ? "audio" : format.kind,
  };
}
