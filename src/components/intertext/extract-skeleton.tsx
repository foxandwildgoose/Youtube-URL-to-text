import { LoaderCircle } from "lucide-react";

export function ExtractSkeleton({ progress }: { progress: string }) {
  return (
    <div className="theme-surface rounded-xl border border-border bg-panel px-5 py-6">
      <p className="flex items-center gap-3 text-sm text-muted">
        <LoaderCircle className="size-4 animate-spin text-accent-text" />
        {progress}
      </p>
      <p className="mt-2 text-sm text-subtle">
        Public caption tracks only — the video is not downloaded. Summary is written after the
        transcript is cleaned.
      </p>
      <div className="mt-5 space-y-3" aria-hidden="true">
        <div className="skeleton-pulse h-8 w-2/3 rounded-md" />
        <div className="skeleton-pulse h-3 w-full rounded-sm" />
        <div className="skeleton-pulse h-3 w-11/12 rounded-sm" />
        <div className="skeleton-pulse h-3 w-4/5 rounded-sm" />
        <div className="skeleton-pulse mt-4 h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
