import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OpenAITranscriptionProvider,
  TranscriptionClientError,
  checkTranscriptionConfiguration,
} from "./transcription-client.ts";
import type { AudioChunk, TranscriptionOptions } from "./media-types.ts";
import { MAX_CHUNK_BYTES, MAX_TRANSCRIPTION_REQUEST_BYTES } from "./transcription-contract.ts";
import { handleTranscriptionRequest } from "./transcription.server.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const chunk: AudioChunk = {
  id: "chunk-0",
  index: 0,
  start: 0,
  end: 306,
  coreStart: 0,
  coreEnd: 300,
  blob: new Blob(["audio section"], { type: "audio/mpeg" }),
  mimeType: "audio/mpeg",
  fileName: "section.mp3",
};
const options: TranscriptionOptions = {
  language: "ko-en",
  contentMode: "ai-conference",
  keywords: ["NVIDIA"],
  previousContext: "x".repeat(600),
};

describe("OpenAI client provider", () => {
  it("checks safe configuration without injecting any browser API key", async () => {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/transcription-config");
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return Response.json({
        configured: false,
        model: "gpt-transcribe",
        requiresAccessToken: true,
        message: "OPENAI_API_KEY is not configured.",
      });
    };
    assert.equal((await checkTranscriptionConfiguration()).configured, false);
  });

  it("uploads only the prepared chunk and last 400 context characters", async () => {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/transcription");
      assert.equal(new Headers(init?.headers).get("x-intertext-access-token"), "personal-code");
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      assert.match(
        new Headers(init?.headers).get("content-type")!,
        /^multipart\/form-data; boundary=/,
      );
      const outgoing = new Request("https://intertext.test/api/transcription", init);
      const form = await outgoing.formData();
      assert.equal((form.get("file") as File).size, chunk.blob.size);
      const metadata = JSON.parse(form.get("metadata") as string);
      assert.equal(metadata.previousContext.length, 400);
      assert.equal(metadata.language, "ko-en");
      return Response.json({
        ok: true,
        transcript: {
          text: "한국어와 English.",
          language: "ko, en",
          timestampQuality: "chunk-estimated",
        },
      });
    };
    const result = await new OpenAITranscriptionProvider("personal-code").transcribeChunk(
      chunk,
      options,
    );
    assert.equal(result.text, "한국어와 English.");
  });

  it("fails before network for oversized and already-cancelled chunks", async () => {
    globalThis.fetch = async () => {
      assert.fail("No request expected.");
    };
    const provider = new OpenAITranscriptionProvider();
    await assert.rejects(
      provider.transcribeChunk({ ...chunk, blob: new Blob([new Uint8Array(3_000_001)]) }, options),
      (error: unknown) =>
        error instanceof TranscriptionClientError && error.code === "chunk_too_large",
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      provider.transcribeChunk(chunk, { ...options, signal: controller.signal }),
      (error: unknown) => error instanceof TranscriptionClientError && error.code === "cancelled",
    );
  });

  it("measures the complete UTF-8 multipart request before sending it", async () => {
    globalThis.fetch = async () => {
      assert.fail("An oversized multipart request must never be sent.");
    };
    const maximumAudio = {
      ...chunk,
      blob: new Blob([new Uint8Array(MAX_CHUNK_BYTES)], { type: "audio/mpeg" }),
    };
    // The audio itself is within budget; non-ASCII metadata makes the actual
    // request exceed the limit even though its character count is much lower.
    await assert.rejects(
      new OpenAITranscriptionProvider().transcribeChunk(maximumAudio, {
        ...options,
        prompt: "한".repeat(180_000),
      }),
      (error: unknown) =>
        error instanceof TranscriptionClientError && error.code === "chunk_too_large",
    );
    await assert.rejects(
      new OpenAITranscriptionProvider().transcribeChunk(
        { ...maximumAudio, fileName: "x".repeat(510_000) + ".mp3" },
        options,
      ),
      (error: unknown) =>
        error instanceof TranscriptionClientError && error.code === "chunk_too_large",
    );
  });

  it("produces a correctly encoded bounded request that the real endpoint accepts", async () => {
    const code = "test-only-personal-code-1234567890";
    const bytes = new Uint8Array(MAX_CHUNK_BYTES);
    bytes.set([0x49, 0x44, 0x33]);
    const maximumAudio = { ...chunk, blob: new Blob([bytes], { type: "audio/mpeg" }) };
    let providerCalls = 0;
    globalThis.fetch = async (_url, init) => {
      const bodySize = (await new Response(init?.body).blob()).size;
      assert.ok(bodySize > MAX_CHUNK_BYTES, "Multipart overhead must be counted.");
      assert.ok(bodySize <= MAX_TRANSCRIPTION_REQUEST_BYTES);
      const headers = new Headers(init?.headers);
      headers.set("origin", "https://intertext.test");
      const outgoing = new Request("https://intertext.test/api/transcription", {
        ...init,
        headers,
      });
      return handleTranscriptionRequest(outgoing, {
        environment: { OPENAI_API_KEY: "test-only-key", TRANSCRIPTION_ACCESS_TOKEN: code },
        fetch: async (_providerUrl, providerInit) => {
          providerCalls++;
          const form = providerInit?.body as FormData;
          assert.equal((form.get("file") as File).size, MAX_CHUNK_BYTES);
          assert.deepEqual(form.getAll("languages[]"), ["ko", "en"]);
          return Response.json({ text: "한국어와 English." });
        },
      });
    };
    const result = await new OpenAITranscriptionProvider(code).transcribeChunk(
      maximumAudio,
      options,
    );
    assert.equal(result.text, "한국어와 English.");
    assert.equal(providerCalls, 1);
  });

  it("preserves typed failures and identifies network/cancellation and deployment rejection", async () => {
    const provider = new OpenAITranscriptionProvider();
    globalThis.fetch = async () =>
      Response.json(
        {
          ok: false,
          error: { code: "provider_rate_limited", message: "Retry later.", retryable: true },
        },
        { status: 429 },
      );
    await assert.rejects(
      provider.transcribeChunk(chunk, options),
      (error: unknown) =>
        error instanceof TranscriptionClientError &&
        error.code === "provider_rate_limited" &&
        error.retryable === true,
    );
    globalThis.fetch = async () => {
      throw new Error("network");
    };
    await assert.rejects(
      provider.transcribeChunk(chunk, options),
      (error: unknown) => error instanceof TranscriptionClientError && error.code === "network",
    );
    globalThis.fetch = async () => new Response("FUNCTION_PAYLOAD_TOO_LARGE", { status: 413 });
    await assert.rejects(
      provider.transcribeChunk(chunk, options),
      (error: unknown) =>
        error instanceof TranscriptionClientError && error.code === "chunk_too_large",
    );
    globalThis.fetch = async () => Response.json({ ok: false });
    await assert.rejects(
      provider.transcribeChunk(chunk, options),
      (error: unknown) =>
        error instanceof TranscriptionClientError && error.code === "transcription_failed",
    );
  });
});
