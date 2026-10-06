import { MAX_IMAGE_BYTES, MAX_REQUEST_BYTES, PROMPT_VERSION, SCHEMA_VERSION } from "./config.ts";
import { validateExtraction } from "./schema.ts";
import type {
  Crop,
  ImageOperation,
  ModelProfile,
  ProviderResult,
  Region,
  SlideConfiguration,
  SlideProvider,
} from "./types.ts";
export function operationKey(crop: Crop, region: Region, profile: ModelProfile): string {
  return JSON.stringify([
    crop.hash,
    profile.model,
    profile.reasoning,
    profile.detail,
    profile.maxOutputTokens,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      fullWidth: crop.fullWidth,
      fullHeight: crop.fullHeight,
    },
    region.corners,
    region.method,
  ]);
}
export async function getSlideConfiguration(signal?: AbortSignal): Promise<SlideConfiguration> {
  const response = await fetch("/api/slides-config", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Slide configuration could not be loaded.");
  return response.json();
}
export async function imageMultipart(
  operation: ImageOperation,
): Promise<{ body: Blob; contentType: string }> {
  if (operation.blob.type !== "image/png" || operation.blob.size > MAX_IMAGE_BYTES)
    throw new Error("The image exceeds the PNG crop limit.");
  const form = new FormData();
  form.append("image", operation.blob, "slide.png");
  form.append(
    "metadata",
    JSON.stringify({
      stateId: operation.stateId,
      cropId: operation.crop.id,
      profile: operation.profile.id,
      width: operation.crop.width,
      height: operation.crop.height,
      outputLimit: operation.profile.maxOutputTokens,
    }),
  );
  const serialized = new Response(form),
    body = await serialized.blob();
  if (body.size > MAX_REQUEST_BYTES)
    throw new Error("The complete multipart request exceeds 3.5 MB.");
  return { body, contentType: serialized.headers.get("content-type")! };
}
export function slideProvider(accessCode: string, fetcher: typeof fetch = fetch): SlideProvider {
  return {
    async extract(operation) {
      const { body, contentType } = await imageMultipart(operation);
      if (operation.signal.aborted)
        return {
          ok: false,
          error: { code: "cancelled", message: "Cancelled before dispatch.", billing: "none" },
        };
      try {
        const response = await fetcher("/api/slides", {
          method: "POST",
          body,
          headers: { "content-type": contentType, "x-intertext-access-token": accessCode },
          signal: operation.signal,
          cache: "no-store",
        });
        const value = (await response.json()) as ProviderResult;
        if (value.ok) return { ...value, extraction: validateExtraction(value.extraction) };
        if (value.error && ["none", "known", "unknown"].includes(value.error.billing)) return value;
        throw new Error("Invalid slide response.");
      } catch {
        return {
          ok: false,
          error: {
            code: "transport_unknown",
            message:
              "The result was lost or cancelled after dispatch. Billing may have occurred; explicitly approve a retry.",
            billing: "unknown",
          },
        };
      }
    },
  };
}
