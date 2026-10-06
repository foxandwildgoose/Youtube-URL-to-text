import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { inspectSlideFile, seekFrame, waitMedia } from "./frame-source.ts";
describe("video-only frame contracts", () => {
  it("waits for decoded frame readiness and records the actual variable-frame-rate source time", async () => {
    let callback: VideoFrameRequestCallback | undefined;
    const fake = new EventTarget() as HTMLVideoElement;
    Object.assign(fake, {
      duration: 10,
      cancelVideoFrameCallback: () => {},
      requestVideoFrameCallback: (cb: VideoFrameRequestCallback) => {
        callback = cb;
        return 1;
      },
    });
    Object.defineProperty(fake, "currentTime", {
      get: () => 0,
      set: () =>
        queueMicrotask(() => callback!(0, { mediaTime: 2.43 } as VideoFrameCallbackMetadata)),
    });
    const timing = await seekFrame(fake, 2.5);
    assert.equal(timing.actual, 2.43);
    assert.equal(timing.method, "video-frame-callback");
    assert(timing.uncertaintySec >= 0.069);
  });
  it("reports seek timeout and cancellation rather than stale frames", async () => {
    const fake = new EventTarget() as HTMLVideoElement;
    Object.assign(fake, {
      duration: 10,
      currentTime: 0,
      cancelVideoFrameCallback: () => {},
      requestVideoFrameCallback: () => 1,
    });
    await assert.rejects(seekFrame(fake, 1, undefined, 5));
    const controller = new AbortController();
    const promise = waitMedia(fake, "seeked", controller.signal, 500);
    controller.abort();
    await assert.rejects(promise);
  });
  it("explicitly labels the less-precise seeked fallback", async () => {
    const fake = new EventTarget() as HTMLVideoElement;
    Object.assign(fake, { duration: 10, readyState: 2 });
    Object.defineProperty(fake, "currentTime", {
      get: () => 1,
      set: () => queueMicrotask(() => fake.dispatchEvent(new Event("seeked"))),
    });
    const old = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => {
      queueMicrotask(() => cb(0));
      return 1;
    };
    try {
      const timing = await seekFrame(fake, 1);
      assert.equal(timing.method, "seeked-fallback");
      assert.equal(timing.uncertaintySec, 0.25);
    } finally {
      globalThis.requestAnimationFrame = old;
    }
  });
  it("only samples a source fingerprint without reading the whole MP4", async () => {
    const file = new File(
      [new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112]), new Uint8Array(100_000)],
      "no-audio.mp4",
      { type: "video/mp4", lastModified: 1 },
    );
    file.arrayBuffer = () => {
      throw new Error("whole original file read");
    };
    const hash = await inspectSlideFile(file);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
  it("hard-isolates visual modules from transcription, audio processing and summaries", async () => {
    const names = await readdir(new URL(".", import.meta.url));
    for (const name of names.filter(
      (n) => n.endsWith(".ts") && !n.includes(".test.") && !n.includes("test-fixtures"),
    )) {
      const source = await readFile(new URL(name, import.meta.url), "utf8");
      assert(
        !/(?:from\s+["']|import\(["'])[^"']*(?:media-processor|upload-pipeline|transcription|summarize)/.test(
          source,
        ),
        name,
      );
    }
    const adapter = await readFile(new URL("./frame-source.ts", import.meta.url), "utf8");
    assert(adapter.includes('"0:v:0"'));
    assert(adapter.includes('"-an"'));
    assert(adapter.includes("FFFSType.WORKERFS"));
    assert(!adapter.includes("file.arrayBuffer("));
    assert(!adapter.includes("writeFile("));
  });
});
