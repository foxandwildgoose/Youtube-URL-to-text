import { createServerFn } from "@tanstack/react-start";
import { isVideoId } from "./parse-url";
import { runWaterfall } from "./providers";
import type { ExtractInput, ExtractResult } from "./types";

export type { ExtractInput };

export const extractTranscript = createServerFn({ method: "POST" })
  .validator((input: ExtractInput): ExtractInput => {
    if (!input || !isVideoId(input.videoId)) {
      throw new Error("Invalid video ID.");
    }
    if (input.lang !== "auto" && input.lang !== "ko" && input.lang !== "en") {
      throw new Error("Invalid language.");
    }
    return { videoId: input.videoId, lang: input.lang };
  })
  .handler(async ({ data }): Promise<ExtractResult> => {
    return runWaterfall(data.videoId, data.lang);
  });
