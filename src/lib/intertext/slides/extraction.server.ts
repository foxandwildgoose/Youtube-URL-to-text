import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_REQUEST_BYTES,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from "./config.ts";
import { extractionSchema, validateExtraction } from "./schema.ts";
import { PRICING } from "./pricing.ts";
import { SLIDE_INSTRUCTION } from "./prompt.server.ts";
import type {
  ModelProfile,
  ProviderResult,
  SlideConfiguration,
  SlideError,
  Usage,
} from "./types.ts";
type Environment = Partial<
  Record<
    | "OPENAI_API_KEY"
    | "SLIDES_ACCESS_TOKEN"
    | "TRANSCRIPTION_ACCESS_TOKEN"
    | "SLIDES_STANDARD_MODEL"
    | "SLIDES_ECONOMY_MODEL"
    | "SLIDES_STANDARD_REASONING"
    | "SLIDES_ECONOMY_REASONING"
    | "SLIDES_DETAIL"
    | "SLIDES_MAX_OUTPUT_TOKENS"
    | "SLIDES_TIMEOUT_MS"
    | "SLIDES_INPUT_USD_PER_M"
    | "SLIDES_OUTPUT_USD_PER_M",
    string
  >
>;
const RESPONSE_LIMIT = 500_000;
function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
function numberSetting(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error("Invalid slide token, timeout or pricing setting.");
  return n;
}
export function slideConfiguration(env: Environment = process.env): SlideConfiguration {
  try {
    const models = [
      env.SLIDES_STANDARD_MODEL?.trim() || "gpt-6.1-sol",
      env.SLIDES_ECONOMY_MODEL?.trim() || "gpt-6-luna",
    ];
    if (models[0] !== "gpt-6.1-sol" || models[1] !== "gpt-6-luna")
      throw new Error(
        "Slide models must be allowlisted gpt-6.1-sol / gpt-6-luna. No automatic model replacement is performed.",
      );
    const reasoning = [
      env.SLIDES_STANDARD_REASONING ?? "low",
      env.SLIDES_ECONOMY_REASONING ?? "none",
    ];
    if (reasoning[0] !== "low" || !["none", "low"].includes(reasoning[1]!))
      throw new Error("Use low reasoning for Sol and none or low for Luna.");
    const detail = env.SLIDES_DETAIL ?? "auto";
    if (!["auto", "high"].includes(detail))
      throw new Error(
        "Use auto or high detail. Original detail is not enabled until model-specific support is verified.",
      );
    const maxOutputTokens = numberSetting(env.SLIDES_MAX_OUTPUT_TOKENS, 4096, 512, 8192),
      timeoutMs = numberSetting(env.SLIDES_TIMEOUT_MS, 45_000, 1000, 50_000);
    const profiles: ModelProfile[] = models.map((model, i) => ({
      id: i === 0 ? "standard" : "economy",
      model,
      reasoning: reasoning[i] as ModelProfile["reasoning"],
      detail: detail as ModelProfile["detail"],
      maxOutputTokens,
      pricing: { ...PRICING[model as keyof typeof PRICING] },
    }));
    // Optional Standard-rate overrides are explicit and marked as operator data, never verified rates.
    if (env.SLIDES_INPUT_USD_PER_M !== undefined || env.SLIDES_OUTPUT_USD_PER_M !== undefined) {
      profiles[0]!.pricing = {
        ...profiles[0]!.pricing,
        input: numberSetting(env.SLIDES_INPUT_USD_PER_M, 2, 0, 1000),
        output: numberSetting(env.SLIDES_OUTPUT_USD_PER_M, 10, 0, 1000),
        version: "operator-override",
        verifiedOn: "operator supplied",
      };
    }
    const token = env.SLIDES_ACCESS_TOKEN?.trim() || env.TRANSCRIPTION_ACCESS_TOKEN?.trim() || "";
    const message = !env.OPENAI_API_KEY?.trim()
      ? "Slide extraction requires server OPENAI_API_KEY. Local preview and scanning still work."
      : token.length < 24
        ? "Set a random 24+ character SLIDES_ACCESS_TOKEN (or TRANSCRIPTION_ACCESS_TOKEN fallback) on the server."
        : undefined;
    return {
      configured: !message,
      ...(message ? { message } : {}),
      profiles,
      timeoutMs,
      maxRequestBytes: MAX_REQUEST_BYTES,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
    };
  } catch (error) {
    return {
      configured: false,
      message: error instanceof Error ? error.message : "Invalid slide configuration.",
      profiles: [],
      timeoutMs: 45_000,
      maxRequestBytes: MAX_REQUEST_BYTES,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
    };
  }
}
export function handleSlideConfiguration(env: Environment = process.env): Response {
  return json(slideConfiguration(env));
}
class Rejected extends Error {
  status: number;
  detail: SlideError;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.detail = { code, message, billing: "none" };
  }
}
export async function boundedRead(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) throw new Rejected(400, "empty_body", "An image request is required.");
  const reader = stream.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Rejected(
          413,
          "payload_too_large",
          "The complete request exceeds 3.5 MB. Use bounded readable crops.",
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.length < 45 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  )
    throw new Rejected(
      400,
      "invalid_image",
      "Only signed PNG raster images are accepted. Video, audio, SVG and URLs are rejected.",
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (
    view.getUint32(8) !== 13 ||
    !width ||
    !height ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  )
    throw new Rejected(
      400,
      "invalid_dimensions",
      "The raster dimensions exceed the safe image limits.",
    );
  let offset = 8,
    idat = false,
    ended = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    if (size > bytes.length - offset - 12)
      throw new Rejected(400, "invalid_image", "Malformed PNG chunk length.");
    const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (kind === "IDAT" && size > 0) idat = true;
    if (kind === "IEND") {
      ended = size === 0 && offset + 12 === bytes.length;
      break;
    }
    offset += size + 12;
  }
  if (!idat || !ended)
    throw new Rejected(400, "invalid_image", "A complete PNG raster is required.");
  return { width, height };
}
const requestMetadata = z
  .object({
    stateId: z.string().min(1).max(128),
    cropId: z.string().min(1).max(128),
    profile: z.enum(["standard", "economy"]),
    outputLimit: z.number().int().min(512).max(8192),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export function normalizeUsage(value: unknown): Usage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>,
    input = v.input_tokens,
    output = v.output_tokens;
  if (
    typeof input !== "number" ||
    typeof output !== "number" ||
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  )
    return undefined;
  const i = (v.input_tokens_details ?? {}) as Record<string, unknown>,
    o = (v.output_tokens_details ?? {}) as Record<string, unknown>;
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: count(i.cached_tokens),
    cacheWriteTokens: count(i.cache_write_tokens),
    reasoningTokens: count(o.reasoning_tokens),
  };
}
export function parseProviderResponse(
  value: unknown,
  model: string,
  requestId?: string,
): ProviderResult {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const usage = normalizeUsage(raw.usage);
  const output = Array.isArray(raw.output) ? raw.output : [];
  const contents = output.flatMap((item) =>
    item && typeof item === "object" && Array.isArray(item.content) ? item.content : [],
  ) as Record<string, unknown>[];
  const text = contents
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
  if (contents.some((c) => c.type === "refusal"))
    return {
      ok: false,
      model,
      usage,
      error: {
        code: "refusal",
        message: "The model refused this image. Source evidence is retained for review.",
        billing: usage ? "known" : "unknown",
        requestId,
      },
    };
  if (raw.status !== "completed")
    return {
      ok: false,
      model,
      usage,
      partialText: text.slice(0, 100_000),
      error: {
        code: "incomplete",
        message:
          "Extraction did not complete (possibly output allowance or timeout). Partial text is not a completed checkpoint.",
        billing: usage ? "known" : "unknown",
        requestId,
      },
    };
  try {
    return { ok: true, model, requestId, usage, extraction: validateExtraction(JSON.parse(text)) };
  } catch {
    return {
      ok: false,
      model,
      usage,
      partialText: text.slice(0, 100_000),
      error: {
        code: "malformed_response",
        message: "The extraction schema was invalid. Review evidence and deliberately retry.",
        billing: usage ? "known" : "unknown",
        requestId,
      },
    };
  }
}
export async function handleSlideExtraction(
  request: Request,
  env: Environment = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let sent = false;
  try {
    const config = slideConfiguration(env);
    if (!config.configured)
      throw new Rejected(
        503,
        "not_configured",
        config.message ?? "Slide extraction is unavailable.",
      );
    const origin = request.headers.get("origin"),
      site = request.headers.get("sec-fetch-site");
    if (origin !== new URL(request.url).origin || (site && site !== "same-origin"))
      throw new Rejected(403, "origin_denied", "Use this workspace's same-origin slide endpoint.");
    const token = request.headers.get("x-intertext-access-token") ?? "",
      expected = env.SLIDES_ACCESS_TOKEN?.trim() || env.TRANSCRIPTION_ACCESS_TOKEN?.trim() || "";
    if (
      token.length > 1024 ||
      !timingSafeEqual(
        createHash("sha256").update(token).digest(),
        createHash("sha256").update(expected).digest(),
      )
    )
      throw new Rejected(401, "access_denied", "Enter the correct personal slide access code.");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new Rejected(
        415,
        "invalid_content_type",
        "Send one PNG image as binary multipart data.",
      );
    const raw = await boundedRead(request.body, MAX_REQUEST_BYTES);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: raw,
    }).formData();
    if (
      [...form.keys()].length !== 2 ||
      form.getAll("image").length !== 1 ||
      form.getAll("metadata").length !== 1
    )
      throw new Rejected(400, "invalid_fields", "One image and bounded metadata are required.");
    const image = form.get("image"),
      metadata = form.get("metadata");
    if (
      !(image instanceof Blob) ||
      image.type !== "image/png" ||
      image.size > MAX_IMAGE_BYTES ||
      typeof metadata !== "string" ||
      metadata.length > 2000
    )
      throw new Rejected(400, "invalid_image", "Send one bounded PNG crop and valid settings.");
    const parsed = requestMetadata.safeParse(JSON.parse(metadata));
    if (!parsed.success)
      throw new Rejected(
        400,
        "invalid_metadata",
        "Only state/crop/profile/dimension/output metadata is accepted. Browser prompts and external URLs are rejected.",
      );
    const m = parsed.data;
    const bytes = new Uint8Array(await image.arrayBuffer()),
      dimensions = pngDimensions(bytes);
    if (dimensions.width !== m.width || dimensions.height !== m.height)
      throw new Rejected(400, "invalid_dimensions", "Image dimensions do not match metadata.");
    const profile = config.profiles.find((p) => p.id === m.profile)!;
    if (m.outputLimit > profile.maxOutputTokens)
      throw new Rejected(
        400,
        "output_limit",
        "The requested output allowance exceeds the server limit.",
      );
    if (request.signal.aborted) throw new Rejected(499, "cancelled", "Cancelled before dispatch.");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, config.timeoutMs);
    try {
      sent = true;
      const response = await fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: profile.model,
          store: false,
          service_tier: "default",
          reasoning: { effort: profile.reasoning },
          max_output_tokens: m.outputLimit,
          instructions: SLIDE_INSTRUCTION,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_image",
                  image_url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
                  detail: profile.detail,
                },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "slide_text",
              strict: true,
              schema: z.toJSONSchema(extractionSchema),
            },
          },
        }),
      });
      const requestId = response.headers.get("x-request-id")?.slice(0, 200);
      const body = await boundedRead(response.body, RESPONSE_LIMIT);
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return json(
          {
            ok: false,
            error: {
              code: "malformed_response",
              message: "Provider response was not valid JSON.",
              billing: "unknown",
              requestId,
            },
          },
          502,
        );
      }
      if (!response.ok) {
        const record = value as { error?: { code?: string } };
        const exhausted =
          record.error?.code === "insufficient_quota" ||
          record.error?.code === "billing_hard_limit_reached";
        const retryable = response.status === 429 && !exhausted;
        const permanent = [400, 401, 403, 404, 422, 429].includes(response.status);
        const retryAfter = Math.min(
          30,
          Math.max(1, Number(response.headers.get("retry-after")) || 2),
        );
        return json(
          {
            ok: false,
            error: {
              code: exhausted
                ? "quota_exhausted"
                : retryable
                  ? "rate_limited"
                  : response.status === 404
                    ? "model_unavailable"
                    : "provider_rejected",
              message: exhausted
                ? "OpenAI quota is exhausted. Update billing before retrying."
                : retryable
                  ? "Image extraction is rate limited."
                  : "The configured model rejected the request. Check model access, schema and server settings; no replacement model was used.",
              retryable,
              retryAfterSec: retryAfter,
              billing: permanent ? "none" : "unknown",
              requestId,
            },
          },
          response.status >= 500 ? 502 : response.status,
        );
      }
      return json(parseProviderResponse(value, profile.model, requestId));
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
    }
  } catch (error) {
    if (error instanceof Rejected)
      return sent
        ? json(
            {
              ok: false,
              error: {
                code: "provider_response_limit",
                message:
                  "The accepted provider response exceeded the safe response bound. Billing is unknown; review before retrying.",
                billing: "unknown",
              },
            },
            502,
          )
        : json({ ok: false, error: error.detail }, error.status);
    return json(
      {
        ok: false,
        error: {
          code: sent ? "transport_unknown" : "invalid_request",
          message: sent
            ? "The provider outcome is unknown. The request may be billed; review before deliberately retrying."
            : "Invalid image request or settings.",
          billing: sent ? "unknown" : "none",
        },
      },
      sent ? 502 : 400,
    );
  }
}
