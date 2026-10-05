import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getTranscriptionConfiguration,
  handleTranscriptionConfiguration,
  handleTranscriptionRequest,
} from "./transcription.server.ts";
import { MAX_CHUNK_BYTES, MAX_TRANSCRIPTION_REQUEST_BYTES } from "./transcription-contract.ts";

const accessToken = "test-only-personal-code-1234567890";
const environment = {
  OPENAI_API_KEY: "test-only-api-key",
  TRANSCRIPTION_ACCESS_TOKEN: accessToken,
};
const metadata = {
  chunk: { id: "test-0", index: 0, start: 0, end: 306, coreStart: 0, coreEnd: 300 },
  language: "ko-en",
  contentMode: "ai-conference",
  keywords: ["NVIDIA", "HBM4"],
  prompt: "Preserve names as spoken.",
  previousContext: "이전 문맥 with English.",
};
const mp3 = new Blob(
  [new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64])],
  { type: "audio/mpeg" },
);

function request(
  options: {
    file?: Blob;
    data?: unknown;
    origin?: string;
    token?: string;
    site?: string;
    contentLength?: string;
    extraField?: boolean;
    signal?: AbortSignal;
  } = {},
): Request {
  const form = new FormData();
  form.append("file", options.file ?? mp3, "section.mp3");
  form.append("metadata", JSON.stringify(options.data ?? metadata));
  if (options.extraField) form.append("extra", "unexpected");
  const headers: Record<string, string> = {
    origin: options.origin ?? "https://intertext.test",
    "x-intertext-access-token": options.token ?? accessToken,
  };
  if (options.site) headers["sec-fetch-site"] = options.site;
  if (options.contentLength) headers["content-length"] = options.contentLength;
  return new Request("https://intertext.test/api/transcription", {
    method: "POST",
    headers,
    body: form,
    signal: options.signal,
  });
}

describe("server transcription configuration and authorization", () => {
  it("boots safely with no key, short/missing access code, or unsupported model", async () => {
    assert.equal(getTranscriptionConfiguration({}).configured, false);
    assert.match(getTranscriptionConfiguration({}).message!, /OPENAI_API_KEY/);
    assert.equal(getTranscriptionConfiguration({ OPENAI_API_KEY: "key" }).configured, false);
    assert.equal(
      getTranscriptionConfiguration({ ...environment, TRANSCRIPTION_ACCESS_TOKEN: "short" })
        .configured,
      false,
    );
    assert.equal(
      getTranscriptionConfiguration({
        ...environment,
        OPENAI_TRANSCRIPTION_MODEL: "not-a-real-model",
      }).configured,
      false,
    );
    assert.equal(getTranscriptionConfiguration(environment).model, "gpt-transcribe");
    const response = handleTranscriptionConfiguration(environment);
    const body = await response.text();
    assert.doesNotMatch(body, /test-only-api-key|test-only-personal-code/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("never reaches the billable API without configuration, personal code, and same origin", async () => {
    const fetchMock: typeof fetch = async () => {
      assert.fail("A denied request must never call OpenAI.");
    };
    assert.equal(
      (await handleTranscriptionRequest(request(), { environment: {}, fetch: fetchMock })).status,
      503,
    );
    for (const denied of [
      request({ token: "wrong" }),
      request({ origin: "https://attacker.test" }),
      request({ site: "cross-site" }),
      request({ site: "same-site" }),
    ]) {
      const response = await handleTranscriptionRequest(denied, { environment, fetch: fetchMock });
      assert.ok(response.status === 401 || response.status === 403);
      assert.equal((await response.json()).error.code, "provider_auth_failed");
    }
    const missingOrigin = request();
    missingOrigin.headers.delete("origin");
    assert.equal(
      (await handleTranscriptionRequest(missingOrigin, { environment, fetch: fetchMock })).status,
      403,
    );
  });
});

describe("transcription upload validation", () => {
  const neverFetch: typeof fetch = async () => {
    assert.fail("Validation must happen before OpenAI.");
  };

  it("bounds advertised and actual payload size, including multipart metadata", async () => {
    const advertised = await handleTranscriptionRequest(
      request({ contentLength: String(MAX_TRANSCRIPTION_REQUEST_BYTES + 1) }),
      { environment, fetch: neverFetch },
    );
    assert.equal(advertised.status, 413);
    const big = new Uint8Array(MAX_CHUNK_BYTES + 1);
    big.set([0x49, 0x44, 0x33]);
    const oversizedFile = await handleTranscriptionRequest(
      request({ file: new Blob([big], { type: "audio/mpeg" }) }),
      { environment, fetch: neverFetch },
    );
    assert.equal(oversizedFile.status, 413);
    const boundary = "boundary";
    let streamCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_TRANSCRIPTION_REQUEST_BYTES + 1));
      },
      cancel() {
        streamCancelled = true;
      },
    });
    const streamed = new Request("https://intertext.test/api/transcription", {
      method: "POST",
      headers: {
        origin: "https://intertext.test",
        "x-intertext-access-token": accessToken,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const response = await handleTranscriptionRequest(streamed, { environment, fetch: neverFetch });
    assert.equal(response.status, 413);
    assert.equal(streamCancelled, true);
  });

  it("rejects whole-video MIME, forged audio signatures, duplicate fields, and bad offsets", async () => {
    const cases = [
      request({ file: new Blob(["video"], { type: "video/mp4" }) }),
      request({ file: new Blob(["not an mp3"], { type: "audio/mpeg" }) }),
      request({ extraField: true }),
      request({ data: { ...metadata, chunk: { ...metadata.chunk, coreEnd: 400 } } }),
      request({ data: { ...metadata, language: "zz" } }),
      request({ data: { ...metadata, keywords: new Array(81).fill("keyword") } }),
      request({ data: { ...metadata, keywords: ["invalid\nterm"] } }),
      request({ data: { ...metadata, prompt: "x".repeat(1_201) } }),
      request({ data: { ...metadata, previousContext: "x".repeat(401) } }),
    ];
    for (const invalid of cases) {
      const response = await handleTranscriptionRequest(invalid, {
        environment,
        fetch: neverFetch,
      });
      assert.ok(response.status === 400 || response.status === 415);
    }
    const duplicate = request();
    const form = await duplicate.formData();
    form.append("file", mp3, "duplicate.mp3");
    const repeated = new Request(duplicate.url, {
      method: "POST",
      headers: { origin: "https://intertext.test", "x-intertext-access-token": accessToken },
      body: form,
    });
    assert.equal(
      (await handleTranscriptionRequest(repeated, { environment, fetch: neverFetch })).status,
      400,
    );
  });
});

describe("OpenAI transcription normalization", () => {
  it("sends documented native mixed-language and keyword hints with concise continuity", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-api-key");
      const body = init?.body as FormData;
      assert.equal(body.get("model"), "gpt-transcribe");
      assert.equal(body.get("response_format"), "json");
      assert.deepEqual(body.getAll("languages[]"), ["ko", "en"]);
      assert.deepEqual(body.getAll("keywords[]"), ["NVIDIA", "HBM4"]);
      assert.equal(body.has("language"), false);
      assert.equal((body.get("file") as File).name, "audio-section.mp3");
      assert.match(body.get("prompt") as string, /do not invent missing terms/);
      assert.match(body.get("prompt") as string, /이전 문맥 with English/);
      assert.ok(init?.signal);
      return Response.json({
        text: "NVIDIA의 HBM4 발표입니다.",
        languages: [{ code: "ko" }, { code: "en" }],
        usage: { billable: "private provider metadata" },
      });
    };
    const response = await handleTranscriptionRequest(request(), { environment, fetch: fetchMock });
    assert.equal(calls, 1);
    assert.deepEqual(await response.json(), {
      ok: true,
      transcript: {
        text: "NVIDIA의 HBM4 발표입니다.",
        language: "ko, en",
        timestampQuality: "chunk-estimated",
      },
    });
  });

  it("omits forced language in auto/mixed mode and adapts documented older models", async () => {
    for (const mode of ["ko-en", "auto", "ko"]) {
      const fetchMock: typeof fetch = async (_url, init) => {
        const body = init?.body as FormData;
        assert.equal(body.has("languages[]"), false);
        assert.equal(body.has("keywords[]"), false);
        assert.equal(body.get("language"), mode === "ko" ? "ko" : null);
        assert.match(body.get("prompt") as string, /Relevant vocabulary: NVIDIA, HBM4/);
        return Response.json({ text: "A transcript.", language: "en" });
      };
      const response = await handleTranscriptionRequest(
        request({ data: { ...metadata, language: mode } }),
        {
          environment: { ...environment, OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe" },
          fetch: fetchMock,
        },
      );
      assert.equal(response.status, 200);
    }
  });

  it("maps provider auth, rate, size, network and bad responses without raw provider data", async () => {
    for (const [status, code] of [
      [401, "provider_auth_failed"],
      [403, "provider_auth_failed"],
      [429, "provider_rate_limited"],
      [413, "chunk_too_large"],
      [500, "transcription_failed"],
      [400, "transcription_failed"],
    ] as const) {
      const fetchMock: typeof fetch = async () =>
        new Response("sensitive provider message: test-only-api-key", { status });
      const response = await handleTranscriptionRequest(request(), {
        environment,
        fetch: fetchMock,
      });
      const text = await response.text();
      assert.equal(JSON.parse(text).error.code, code);
      assert.doesNotMatch(text, /test-only-api-key|sensitive provider message/);
    }
    const network: typeof fetch = async () => {
      throw new Error("raw network failure with test-only-api-key");
    };
    const networkResponse = await handleTranscriptionRequest(request(), {
      environment,
      fetch: network,
    });
    assert.equal((await networkResponse.json()).error.code, "network");
    const invalid: typeof fetch = async () => Response.json({ secret: "test-only-api-key" });
    assert.equal(
      (await handleTranscriptionRequest(request(), { environment, fetch: invalid })).status,
      502,
    );
    const oversized: typeof fetch = async () => new Response("x".repeat(1_000_001));
    assert.equal(
      (await handleTranscriptionRequest(request(), { environment, fetch: oversized })).status,
      502,
    );
  });

  it("cancels provider requests when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchMock: typeof fetch = async (_url, init) => {
      controller.abort();
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException("aborted", "AbortError");
    };
    const response = await handleTranscriptionRequest(request({ signal: controller.signal }), {
      environment,
      fetch: fetchMock,
    });
    assert.equal(response.status, 499);
    assert.equal((await response.json()).error.code, "cancelled");
  });
});
