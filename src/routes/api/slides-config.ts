import { createFileRoute } from "@tanstack/react-router";
import { handleSlideConfiguration } from "@/lib/intertext/slides/extraction.server";
export const Route = createFileRoute("/api/slides-config")({
  server: { handlers: { GET: () => handleSlideConfiguration() } },
});
