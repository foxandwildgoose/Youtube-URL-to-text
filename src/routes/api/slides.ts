import { createFileRoute } from "@tanstack/react-router";
import { handleSlideExtraction } from "@/lib/intertext/slides/extraction.server";
export const Route = createFileRoute("/api/slides")({
  server: { handlers: { POST: ({ request }) => handleSlideExtraction(request) } },
});
