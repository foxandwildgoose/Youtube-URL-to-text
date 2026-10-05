import { createFileRoute } from "@tanstack/react-router";
import { handleTranscriptionConfiguration } from "@/lib/intertext/transcription.server";

export const Route = createFileRoute("/api/transcription-config")({
  server: { handlers: { GET: () => handleTranscriptionConfiguration() } },
});
