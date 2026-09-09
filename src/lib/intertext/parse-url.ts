import type { VideoRef } from "./types";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

const YT_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

export type ParseResult =
  | { ok: true; video: VideoRef }
  | { ok: false; message: string };

const INVALID_MESSAGE =
  "That does not look like a YouTube URL or video ID. Use youtube.com/watch, youtu.be, shorts, live, embed, or an 11-character ID.";

export function isVideoId(value: string): boolean {
  return VIDEO_ID_RE.test(value);
}

export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function success(videoId: string, originalInput: string): ParseResult {
  return {
    ok: true,
    video: {
      videoId,
      canonicalUrl: canonicalWatchUrl(videoId),
      originalInput,
    },
  };
}

function stripIdNoise(token: string): string {
  return token.replace(/[^a-zA-Z0-9_-].*$/, "");
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  if (YT_HOSTS.has(host)) return true;
  return host.endsWith(".youtube.com");
}

function fromPathKind(parts: string[]): string | null {
  if (parts.length < 2) return null;
  const kind = parts[0]?.toLowerCase();
  if (!kind) return null;
  if (["shorts", "live", "embed", "v", "e", "watch"].includes(kind)) {
    const id = stripIdNoise(parts[1] ?? "");
    return isVideoId(id) ? id : null;
  }
  return null;
}

export function parseYouTubeInput(raw: string): ParseResult {
  const originalInput = raw.trim();
  if (!originalInput) {
    return {
      ok: false,
      message: "Paste a YouTube URL or an 11-character video ID.",
    };
  }

  if (isVideoId(originalInput)) {
    return success(originalInput, originalInput);
  }

  let url: URL;
  try {
    url = new URL(
      originalInput.includes("://") ? originalInput : `https://${originalInput}`,
    );
  } catch {
    return { ok: false, message: INVALID_MESSAGE };
  }

  if (!hostAllowed(url.hostname)) {
    return { ok: false, message: INVALID_MESSAGE };
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  const attribution = url.searchParams.get("u");
  if (attribution) {
    try {
      const innerPath = decodeURIComponent(attribution);
      const nested = parseYouTubeInput(
        innerPath.startsWith("http")
          ? innerPath
          : `https://www.youtube.com${innerPath.startsWith("/") ? "" : "/"}${innerPath}`,
      );
      if (nested.ok) return success(nested.video.videoId, originalInput);
    } catch {
      // fall through
    }
  }

  if (host === "youtu.be") {
    const id = stripIdNoise(url.pathname.split("/").filter(Boolean)[0] ?? "");
    if (isVideoId(id)) return success(id, originalInput);
    return { ok: false, message: INVALID_MESSAGE };
  }

  const v = url.searchParams.get("v");
  if (v) {
    const id = stripIdNoise(v);
    if (isVideoId(id)) return success(id, originalInput);
    return {
      ok: false,
      message:
        "The video ID in that URL is not valid. YouTube IDs are 11 characters (letters, numbers, _ or -).",
    };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const fromPath = fromPathKind(parts);
  if (fromPath) return success(fromPath, originalInput);

  return { ok: false, message: INVALID_MESSAGE };
}
