import { createFileRoute } from "@tanstack/react-router";
import { handleTranscriptionRequest } from "@/lib/intertext/transcription.server";

export const Route = createFileRoute("/api/transcription")({
  server: { handlers: { POST: ({ request }) => handleTranscriptionRequest(request) } },
});
