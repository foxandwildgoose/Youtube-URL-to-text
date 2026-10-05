import { TRANSCRIPTION_CONFIG } from "./media-config.ts";
import { MediaPipelineError, throwIfAborted } from "./media-errors.ts";
import { parseSilenceLog, type SilenceRange } from "./media-chunks.ts";
import type { AudioChunk, ChunkPlan } from "./media-types.ts";

export interface MediaProcessor {
  probeDuration(): Promise<number>;
  findSilences(
    duration: number,
    onBoundary?: (completed: number, total: number) => void,
  ): Promise<SilenceRange[]>;
  encodeChunk(plan: ChunkPlan): Promise<AudioChunk>;
  close(): Promise<void>;
}

/** Lazy, single-thread FFmpeg. WORKERFS reads the File in the worker on demand.
 * No complete source ArrayBuffer, MEMFS source copy, or full intermediate MP3.
 * Official API: https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/FFmpeg/
 * A single-thread core avoids SharedArrayBuffer/cross-origin-isolation requirements.
 */
export async function createMediaProcessor(
  file: File,
  signal?: AbortSignal,
): Promise<MediaProcessor> {
  throwIfAborted(signal);
  const { FFmpeg, FFFSType } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  let mounted = false;
  let closed = false;
  const source = "/source/input";
  const abort = () => {
    closed = true;
    ffmpeg.terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });

  async function close() {
    signal?.removeEventListener("abort", abort);
    if (closed) return;
    closed = true;
    try {
      if (mounted) await ffmpeg.unmount("/source");
    } catch {
      /* terminating releases the whole filesystem */
    } finally {
      ffmpeg.terminate();
    }
  }

  try {
    // ESM is required: @ffmpeg/ffmpeg runs a module worker.
    await ffmpeg.load(
      {
        coreURL: new URL("/ffmpeg/ffmpeg-core.js", location.origin).href,
        wasmURL: new URL("/ffmpeg/ffmpeg-core.wasm", location.origin).href,
      },
      { signal },
    );
    throwIfAborted(signal);
    await ffmpeg.createDir("/source");
    mounted = await ffmpeg.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: "input", data: file }] },
      "/source",
    );
    if (!mounted) throw new Error("This FFmpeg core does not include WORKERFS.");
  } catch (error) {
    await close();
    throwIfAborted(signal);
    throw new MediaPipelineError(
      "audio_extract_failed",
      "Automatic media processing could not start in this browser. Retry, or upload an MP3/M4A version as a fallback.",
      error instanceof Error ? error.message : String(error),
    );
  }

  const execute = async (args: string[], messages: string[] = []) => {
    throwIfAborted(signal);
    const log = ({ message }: { message: string }) => {
      messages.push(message);
    };
    ffmpeg.on("log", log);
    try {
      const code = await ffmpeg.exec(args, -1, { signal });
      throwIfAborted(signal);
      return code;
    } finally {
      ffmpeg.off("log", log);
    }
  };

  return {
    async probeDuration() {
      const messages: string[] = [];
      const code = await execute(
        ["-i", source, "-map", "0:a:0", "-t", "0.01", "-f", "null", "-"],
        messages,
      );
      const match = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(messages.join("\n"));
      if (code !== 0 || !match)
        throw new MediaPipelineError(
          "media_decode_failed",
          "This media could not be decoded, or it has no audio track.",
          messages.slice(-6).join("\n"),
        );
      return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
    },
    async findSilences(duration, onBoundary) {
      const config = TRANSCRIPTION_CONFIG.chunking;
      const total = Math.max(0, Math.ceil(duration / config.targetCoreDurationSec) - 1);
      const ranges: SilenceRange[] = [];
      let completed = 0;
      for (
        let target = config.targetCoreDurationSec;
        target < duration;
        target += config.targetCoreDurationSec
      ) {
        const start = Math.max(0, target - config.boundarySearchWindowSec);
        const length = Math.min(duration, target + config.boundarySearchWindowSec) - start;
        const messages: string[] = [];
        try {
          // Only decode short windows around prospective cuts, not the entire file twice.
          const code = await execute(
            [
              "-ss",
              `${start}`,
              "-i",
              source,
              "-t",
              `${length}`,
              "-map",
              "0:a:0",
              "-vn",
              "-af",
              `silencedetect=noise=${config.silenceNoiseDb}dB:d=${config.minimumSilenceMs / 1_000}`,
              "-f",
              "null",
              "-",
            ],
            messages,
          );
          if (code === 0) ranges.push(...parseSilenceLog(messages, start, length));
          // A failed optimization preserves the mandatory overlap around the fixed cut.
        } catch {
          throwIfAborted(signal);
        }
        onBoundary?.(++completed, total);
      }
      return ranges;
    },
    async encodeChunk(plan) {
      const output = `/audio-${plan.id.replace(/[^a-zA-Z0-9.-]/g, "_")}.mp3`;
      const messages: string[] = [];
      try {
        const audio = TRANSCRIPTION_CONFIG.audio;
        const code = await execute(
          [
            "-ss",
            `${plan.start}`,
            "-i",
            source,
            "-t",
            `${plan.end - plan.start}`,
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            `${audio.channels}`,
            "-ar",
            `${audio.sampleRateHz}`,
            "-c:a",
            "libmp3lame",
            "-b:a",
            `${audio.bitrateKbps}k`,
            "-map_metadata",
            "-1",
            output,
          ],
          messages,
        );
        if (code !== 0)
          throw new MediaPipelineError(
            "audio_encode_failed",
            "Audio preparation failed. Retry, or upload an MP3/M4A version as a fallback.",
            messages.slice(-8).join("\n"),
          );
        const data = await ffmpeg.readFile(output);
        if (typeof data === "string" || data.byteLength === 0)
          throw new MediaPipelineError(
            "chunk_generation_failed",
            "The prepared audio section was empty.",
          );
        // Only this small compressed output crosses the worker boundary.
        const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" });
        return {
          ...plan,
          blob,
          mimeType: "audio/mpeg",
          fileName: `intertext-${plan.index + 1}.mp3`,
        };
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof MediaPipelineError) throw error;
        throw new MediaPipelineError(
          "audio_encode_failed",
          "This browser could not prepare the audio. It may have run out of memory. Retry, or use an MP3/M4A recording as a fallback.",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (!closed)
          try {
            await ffmpeg.deleteFile(output);
          } catch {
            /* no artifact on failed encode */
          }
      }
    },
    close,
  };
}
