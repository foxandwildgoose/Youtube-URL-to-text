import { checkAbort, MAX_DURATION, MAX_FILE_BYTES, SlideFailure } from "./config.ts";
import type { FrameSource, FrameTiming } from "./types.ts";
import { warpFrame } from "./roi.ts";
import { fingerprintMedia } from "../media-fingerprint.ts";
export function waitMedia(
  element: HTMLVideoElement,
  event: string,
  signal?: AbortSignal,
  timeoutMs = 12_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      element.removeEventListener(event, ready);
      element.removeEventListener("error", failed);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish(),
      failed = () =>
        finish(
          new SlideFailure(
            "This browser could not decode a video frame. Try the bounded FFmpeg fallback; unsupported codecs may still fail.",
            "codec_unsupported",
          ),
        ),
      abort = () => finish(new SlideFailure("Frame loading stopped.", "cancelled"));
    const timer = setTimeout(
      () =>
        finish(
          new SlideFailure(
            "Video seek/metadata timed out. Keep the tab active or try the video-only fallback.",
            "seek_timeout",
          ),
        ),
      timeoutMs,
    );
    element.addEventListener(event, ready, { once: true });
    element.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export async function seekFrame(
  video: HTMLVideoElement,
  requested: number,
  signal?: AbortSignal,
  timeoutMs = 8_000,
): Promise<FrameTiming> {
  checkAbort(signal);
  const target = Math.max(0, Math.min(requested, Math.max(0, video.duration - 0.001)));
  if (typeof video.requestVideoFrameCallback === "function") {
    return new Promise((resolve, reject) => {
      let callback = 0;
      const finish = (timing?: FrameTiming, error?: Error) => {
        clearTimeout(timer);
        video.cancelVideoFrameCallback(callback);
        signal?.removeEventListener("abort", abort);
        video.removeEventListener("error", errorEvent);
        if (timing) resolve(timing);
        else reject(error);
      };
      const abort = () => finish(undefined, new SlideFailure("Frame seek stopped.", "cancelled")),
        errorEvent = () =>
          finish(undefined, new SlideFailure("Video decoding failed.", "codec_unsupported"));
      const timer = setTimeout(
        () =>
          finish(
            undefined,
            new SlideFailure(
              "Decoded frame callback timed out. Keep this tab visible or select FFmpeg fallback.",
              "seek_timeout",
            ),
          ),
        timeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      video.addEventListener("error", errorEvent, { once: true });
      callback = video.requestVideoFrameCallback((_now, metadata) =>
        finish({
          requested,
          actual: metadata.mediaTime,
          method: "video-frame-callback",
          uncertaintySec: Math.max(0.02, Math.abs(metadata.mediaTime - target)),
        }),
      );
      // A small seek triggers presentation even when selecting the current paused frame.
      video.currentTime =
        Math.abs(video.currentTime - target) < 0.00001
          ? Math.min(video.duration - 0.001, target + 0.001)
          : target;
    });
  }
  if (Math.abs(video.currentTime - target) > 0.00001) {
    const ready = waitMedia(video, "seeked", signal, timeoutMs);
    video.currentTime = target;
    await ready;
  }
  if (video.readyState < 2) await waitMedia(video, "loadeddata", signal, timeoutMs);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  checkAbort(signal);
  return { requested, actual: video.currentTime, method: "seeked-fallback", uncertaintySec: 0.25 };
}
function validateDimensions(duration: number, width: number, height: number): void {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION)
    throw new SlideFailure(
      "A finite video duration of at most two hours is required.",
      "invalid_duration",
    );
  if (!width || !height || width > 8192 || height > 8192 || width * height > 33_554_432)
    throw new SlideFailure(
      "A decodable video track with dimensions up to 8192 pixels and 33 megapixels is required. Audio-only MP4s are unsupported in this mode.",
      "invalid_dimensions",
    );
}
async function nativeSource(file: File, signal?: AbortSignal): Promise<FrameSource> {
  const video = document.createElement("video"),
    url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  video.style.cssText =
    "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(video);
  const close = async () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };
  try {
    const ready = waitMedia(video, "loadedmetadata", signal);
    video.src = url;
    await ready;
    validateDimensions(video.duration, video.videoWidth, video.videoHeight);
    if (video.readyState < 2) await waitMedia(video, "loadeddata", signal);
    const duration = video.duration,
      width = video.videoWidth,
      height = video.videoHeight;
    return {
      duration,
      width,
      height,
      rotation: "browser-display",
      decoder: "native",
      async capture(time, targetWidth, region, captureSignal) {
        const timing = await seekFrame(video, time, captureSignal ?? signal);
        checkAbort(captureSignal ?? signal);
        const corners = region?.corners ?? [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ];
        return { canvas: warpFrame(video, width, height, corners, targetWidth), timing };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
async function ffmpegSource(file: File, signal?: AbortSignal): Promise<FrameSource> {
  const { FFmpeg, FFFSType } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  let closed = false,
    mounted = false;
  const abort = () => {
    closed = true;
    ffmpeg.terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const close = async () => {
    signal?.removeEventListener("abort", abort);
    if (closed) return;
    closed = true;
    try {
      if (mounted) await ffmpeg.unmount("/source");
    } finally {
      ffmpeg.terminate();
    }
  };
  const exec = async (args: string[]) => {
    checkAbort(signal);
    const logs: string[] = [];
    const log = ({ message }: { message: string }) => {
      if (logs.length < 500) logs.push(message);
    };
    ffmpeg.on("log", log);
    try {
      const code = await ffmpeg.exec(args, 30_000, { signal });
      checkAbort(signal);
      if (code !== 0)
        throw new SlideFailure(
          "Video-only FFmpeg decoding failed. This codec may be unsupported or the browser may lack memory.",
          "codec_unsupported",
        );
      return logs.join("\n");
    } finally {
      ffmpeg.off("log", log);
    }
  };
  try {
    await ffmpeg.load(
      {
        coreURL: new URL("/ffmpeg/ffmpeg-core.js", location.origin).href,
        wasmURL: new URL("/ffmpeg/ffmpeg-core.wasm", location.origin).href,
      },
      { signal },
    );
    await ffmpeg.createDir("/source");
    mounted = await ffmpeg.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: "input", data: file }] },
      "/source",
    );
    if (!mounted) throw new SlideFailure("This FFmpeg build lacks WORKERFS.");
    const logs = await exec([
      "-i",
      "/source/input",
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-dn",
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ]);
    const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(logs),
      dims = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(logs);
    if (!dur || !dims) throw new SlideFailure("FFmpeg could not find a video track and duration.");
    const duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
    let width = Number(dims[1]),
      height = Number(dims[2]);
    const rotation = Number(/rotation of\s+(-?[\d.]+)/.exec(logs)?.[1] ?? 0);
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    validateDimensions(duration, width, height);
    return {
      duration,
      width,
      height,
      rotation,
      decoder: "ffmpeg",
      async capture(time, targetWidth, region, captureSignal) {
        checkAbort(captureSignal ?? signal);
        const requested = Math.min(time, duration - 0.001);
        let bitmap: ImageBitmap | undefined;
        try {
          const messages = await exec([
            "-copyts",
            "-ss",
            String(requested),
            "-i",
            "/source/input",
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-dn",
            "-vf",
            "showinfo",
            "-frames:v",
            "1",
            "-y",
            "/frame.png",
          ]);
          const bytes = await ffmpeg.readFile("/frame.png");
          if (typeof bytes === "string") throw new SlideFailure("Frame output was invalid.");
          bitmap = await createImageBitmap(
            new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
          );
          const pts = /pts_time:([\d.-]+)/.exec(messages);
          const actual = pts ? Number(pts[1]) : requested;
          const timing: FrameTiming = {
            requested: time,
            actual,
            method: pts ? "ffmpeg-pts" : "seeked-fallback",
            uncertaintySec: pts ? Math.max(0.04, Math.abs(actual - requested)) : 0.25,
          };
          return {
            canvas: warpFrame(
              bitmap,
              bitmap.width,
              bitmap.height,
              region?.corners ?? [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
              ],
              targetWidth,
            ),
            timing,
          };
        } finally {
          bitmap?.close();
          if (!closed) await ffmpeg.deleteFile("/frame.png").catch(() => {});
        }
      },
      close,
    };
  } catch (error) {
    await close();
    checkAbort(signal);
    throw error;
  }
}
export async function inspectSlideFile(file: File, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  if (
    !/\.mp4$/i.test(file.name) ||
    !file.size ||
    (file.type && !["video/mp4", "application/mp4"].includes(file.type))
  )
    throw new SlideFailure("Select an MP4 video with a supported video codec.", "unsupported_file");
  if (file.size > MAX_FILE_BYTES)
    throw new SlideFailure(
      "This file exceeds the 1.5 GB admission ceiling. Smaller recordings may still exceed browser resources.",
      "file_too_large",
    );
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!["ftyp", "moov", "mdat", "free", "wide"].includes(String.fromCharCode(...bytes.slice(4, 8))))
    throw new SlideFailure("The selected file does not have an MP4 container signature.");
  return fingerprintMedia(file, signal);
}
export async function createFrameSource(
  file: File,
  signal?: AbortSignal,
  forceFallback = false,
): Promise<FrameSource> {
  checkAbort(signal);
  if (forceFallback) return ffmpegSource(file, signal);
  try {
    return await nativeSource(file, signal);
  } catch {
    checkAbort(signal);
    return ffmpegSource(file, signal);
  }
}
