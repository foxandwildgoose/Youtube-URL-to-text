import { extractTranscript } from "./extract";
import { extractViaYtai } from "./providers";
import { canonicalWatchUrl } from "./parse-url";
import type { ExtractInput, ExtractResult, LangMode } from "./types";

type ServerExtract = (opts: { data: ExtractInput }) => Promise<ExtractResult>;

async function withOembedTitle(result: ExtractResult, videoId: string): Promise<ExtractResult> {
  if (!result.ok) return result;
  if (result.job.title && result.job.title !== videoId) return result;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalWatchUrl(videoId))}&format=json`,
    );
    if (!res.ok) return result;
    const data = (await res.json()) as { title?: unknown };
    if (typeof data.title === "string" && data.title.trim()) {
      return { ok: true, job: { ...result.job, title: data.title.trim() } };
    }
  } catch {
    // Title is optional.
  }
  return result;
}

export async function extractCaptions(
  videoId: string,
  lang: LangMode,
  serverExtract: ServerExtract = (opts) => extractTranscript(opts),
): Promise<ExtractResult> {
  try {
    const direct = await extractViaYtai(videoId, lang);
    if (direct) return withOembedTitle(direct, videoId);
  } catch {
    // CORS / network — continue to the server waterfall.
  }

  try {
    const viaServer = await serverExtract({ data: { videoId, lang } });
    return withOembedTitle(viaServer, videoId);
  } catch (err) {
    const details = err instanceof Error ? err.message : "Caption providers could not be reached.";
    const lower = details.toLowerCase();
    const blocked = lower.includes("403") || lower.includes("429") || lower.includes("blocked");
    return {
      ok: false,
      error: {
        code: blocked ? "provider_blocked" : "network",
        message: blocked
          ? "Caption providers were blocked or rate-limited. Wait a moment and retry, or copy the transcript from YouTube (More → Show transcript)."
          : "Network error reaching caption providers. Check your connection and try again.",
        details,
      },
    };
  }
}
