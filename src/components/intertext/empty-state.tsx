import { Button } from "@/components/ui/button";

const EXAMPLES = [
  {
    label: "Watch URL",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
  {
    label: "Short link",
    url: "https://youtu.be/8S0FDjFBj8o",
  },
  {
    label: "Shorts",
    url: "https://www.youtube.com/shorts/aqz-KE-bpKQ",
  },
] as const;

const STEPS = [
  "Paste a public YouTube URL and pick a summary type (General, Meeting, Course, Interview, or Podcast).",
  "INTERTEXT reads the public caption track, collapses rolling auto-captions, then writes a summary.",
  "The file is title → summary → transcript, using real speaker names. Copy or download it under the same title as the video.",
] as const;

export function EmptyState({ onPick }: { onPick: (url: string) => void }) {
  return (
    <section className="rounded-xl border border-border bg-panel p-5">
      <h2 className="font-serif text-xl tracking-tight">How it works</h2>
      <ol className="mt-4 space-y-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex gap-3 text-sm leading-relaxed text-muted">
            <span className="font-serif text-lg leading-none text-accent tabular-nums">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs font-medium tracking-wide text-subtle uppercase">
        Example URLs
      </p>
      <ul className="mt-2 space-y-2">
        {EXAMPLES.map((ex) => (
          <li key={ex.url}>
            <Button
              variant="outline"
              size="wrap"
              className="h-auto w-full justify-start px-3 py-3 text-left"
              onClick={() => onPick(ex.url)}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-subtle">{ex.label}</span>
                <span className="truncate font-mono text-xs text-fg">{ex.url}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Korean and English both work. Interview mode names the host and guest from the
        talk — it does not invent A/B dialogue.
      </p>
    </section>
  );
}
