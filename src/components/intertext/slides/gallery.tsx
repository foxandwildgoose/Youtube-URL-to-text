import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAsset } from "@/lib/intertext/slides/assets";
import { formatSlideTime, literalBlock, stateBlocks } from "@/lib/intertext/slides/export";
import type { DisplayState } from "@/lib/intertext/slides/types";
export function EvidenceImage({
  assetId,
  alt,
  zoom = false,
}: {
  assetId: string;
  alt: string;
  zoom?: boolean;
}) {
  const [url, setUrl] = useState<string>(),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      objectUrl: string | undefined;
    setUrl(undefined);
    setError("");
    void getAsset(assetId)
      .then((blob) => {
        if (stopped) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        } else setError("Evidence missing: re-select the recording and regenerate this frame.");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Evidence unavailable."));
    return () => {
      stopped = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);
  return (
    <div className="min-w-0 space-y-2">
      {url ? (
        <div className={expanded ? "max-h-96 overflow-auto" : ""}>
          <img
            src={url}
            alt={alt}
            className={expanded ? "max-w-none" : "max-h-80 w-full rounded-lg object-contain"}
          />
        </div>
      ) : (
        <p className="text-xs text-muted">{error || "Loading selected evidence…"}</p>
      )}
      {zoom && url ? (
        <Button variant="ghost" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Fit evidence" : "Zoom source image"}
        </Button>
      ) : null}
    </div>
  );
}
export function CandidateGallery({
  states,
  active,
  onActive,
  onChange,
  onSeek,
  disabled,
}: {
  states: DisplayState[];
  active?: string;
  onActive: (id: string) => void;
  onChange: (state: DisplayState) => void;
  onSeek: (time: number) => void;
  disabled: boolean;
}) {
  return (
    <section aria-label="Chronological slide candidates" className="space-y-3">
      <h3 className="label-caps text-muted">Display states · {states.length}</h3>
      <p className="text-xs text-muted">
        Each appearance is kept, including revisited slides and animation states. Groups affect
        navigation only. Textless images remain reviewable.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {states.map((state, i) => {
          const evidence = state.evidence.find((e) => e.id === state.representativeId);
          return (
            <article
              key={state.id}
              className={`min-w-0 rounded-lg border bg-panel p-3 ${state.id === active ? "border-accent" : "border-border"}`}
            >
              <button
                type="button"
                aria-label={`Review slide ${i + 1}`}
                disabled={disabled}
                className="block min-h-11 w-full text-left"
                onClick={() => {
                  onActive(state.id);
                  onSeek(evidence?.time.actual ?? state.start);
                }}
              >
                {evidence ? (
                  <EvidenceImage
                    assetId={evidence.assetId}
                    alt={`Candidate ${i + 1} at ${formatSlideTime(evidence.time.actual)}`}
                  />
                ) : null}
                <span className="mt-2 block text-sm">
                  Slide {String(i + 1).padStart(3, "0")} · {state.status}
                </span>
                <span className="block font-mono text-xs text-muted">
                  {formatSlideTime(state.start)} – {formatSlideTime(state.end)}
                </span>
              </button>
              <label className="mt-2 flex min-h-11 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={state.selected}
                  disabled={disabled || state.status === "excluded"}
                  onChange={(e) => onChange({ ...state, selected: e.target.checked })}
                />
                Select for extraction
              </label>
              <p className="text-xs break-words text-muted">{state.flags.join(" · ")}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
export function SlideReview({
  state,
  onChange,
  onRetry,
  onReplace,
  onAlternative,
  disabled,
}: {
  state: DisplayState;
  onChange: (state: DisplayState) => void;
  onRetry: (cropIds: string[]) => void;
  onReplace: () => void;
  onAlternative: (id: string) => void;
  disabled: boolean;
}) {
  const evidence = state.evidence.find((e) => e.id === state.representativeId),
    blocks = stateBlocks(state);
  const acceptedId = evidence?.crops[0]
    ? state.acceptedAttemptIds?.[evidence.crops[0].id]
    : undefined;
  const selected =
      state.attempts.find((a) => a.id === acceptedId) ??
      state.attempts.filter((a) => a.outcome === "completed").at(-1),
    [search, setSearch] = useState("");
  const changeBoundary = (axis: "start" | "end", time: number) => {
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      (axis === "start" && time > state.end) ||
      (axis === "end" && time < state.start)
    )
      return;
    onChange({
      ...state,
      [axis]: time,
      [`${axis}Boundary`]: { low: time, high: time, method: "seeked-fallback", uncertain: true },
      flags: [...new Set([...state.flags, "boundary-uncertain" as const])],
    });
  };
  return (
    <section
      aria-label="Slide text review"
      className="space-y-4 rounded-xl border border-border bg-panel p-4"
    >
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() =>
          onChange({
            ...state,
            status: state.status === "excluded" ? "pending" : "excluded",
            selected: state.status === "excluded",
          })
        }
      >
        {state.status === "excluded"
          ? "Restore excluded appearance"
          : "Mark non-slide / exclude appearance (keep evidence)"}
      </Button>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs">
          Start seconds
          <Input
            aria-label="State start seconds"
            type="number"
            step="0.1"
            value={state.start}
            disabled={disabled}
            onChange={(e) => changeBoundary("start", Number(e.target.value))}
          />
        </label>
        <label className="text-xs">
          End seconds
          <Input
            aria-label="State end seconds"
            type="number"
            step="0.1"
            value={state.end}
            disabled={disabled}
            onChange={(e) => changeBoundary("end", Number(e.target.value))}
          />
        </label>
        <label className="text-xs">
          Navigation group
          <Input
            aria-label="Slide navigation group"
            value={state.groupId ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...state, groupId: e.target.value || undefined })}
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        Intervals are [start,end). Boundary brackets: {state.startBoundary.low.toFixed(2)}–
        {state.startBoundary.high.toFixed(2)} / {state.endBoundary.low.toFixed(2)}–
        {state.endBoundary.high.toFixed(2)} seconds. Formatting does not imply millisecond accuracy.
      </p>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3">
          {evidence ? (
            <EvidenceImage
              assetId={evidence.crops[0]?.assetId ?? evidence.assetId}
              alt="High resolution source evidence"
              zoom
            />
          ) : null}
          <Button disabled={disabled} variant="secondary" onClick={onReplace}>
            Capture replacement / alternative at playback time
          </Button>
          {state.evidence.map((e) => (
            <Button
              key={e.id}
              disabled={disabled}
              variant="ghost"
              onClick={() => onAlternative(e.id)}
            >
              {e.id === state.representativeId ? "Current" : "Use alternative"} ·{" "}
              {formatSlideTime(e.time.actual)} · sharpness {e.sharpness.toFixed(3)}
            </Button>
          ))}
          <p className="text-xs text-muted">
            Use an alternative only after confirming identical visible content. Crops preserve
            resolution; overlap text remains separate evidence and may need manual review.
          </p>
          {evidence?.crops.map((c) => (
            <div key={c.id} className="space-y-2 border-t border-border pt-2">
              <p className="text-xs">
                Crop {c.x},{c.y} · {c.width}×{c.height}
              </p>
              <EvidenceImage assetId={c.assetId} alt={`Source crop at ${c.x},${c.y}`} zoom />
              <Button disabled={disabled} variant="ghost" onClick={() => onRetry([c.id])}>
                Approve paid retry of this crop
              </Button>
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <Input
            aria-label="Search slide text"
            placeholder="Search literal text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {selected?.extraction?.status === "textless" ? (
            <p className="text-sm">Textless source region · no invented text</p>
          ) : null}
          {blocks
            .filter((b) =>
              `${b.edited ?? literalBlock(b.block)}`.toLowerCase().includes(search.toLowerCase()),
            )
            .map(({ key, block, edited }) => (
              <div key={key} className="space-y-2">
                <p className="text-xs text-muted">
                  {block.type} · literal source and separate correction
                </p>
                <pre className="slide-source whitespace-pre-wrap break-words rounded-lg bg-bg p-3 font-mono text-xs">
                  {literalBlock(block)}
                </pre>
                <textarea
                  aria-label={`Edit slide block ${key}`}
                  className="min-h-24 w-full rounded-lg border border-border bg-bg p-3 font-mono text-sm"
                  value={edited ?? literalBlock(block)}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ ...state, edits: { ...state.edits, [key]: e.target.value } })
                  }
                />
              </div>
            ))}
          {!blocks.length && selected?.extraction?.status !== "textless" ? (
            <p className="text-sm text-muted">
              Text extraction is pending or incomplete. Evidence is retained.
            </p>
          ) : null}
          <Button
            disabled={disabled}
            variant="secondary"
            onClick={() => onRetry(evidence?.crops.map((c) => c.id) ?? [])}
          >
            Approve paid retry of this state
          </Button>
          <details>
            <summary className="min-h-11 cursor-pointer text-sm">
              Immutable attempts, partial output and comparison
            </summary>
            {state.attempts.map((a) => (
              <div key={a.id} className="mt-2 rounded-lg border border-border p-2">
                <p className="text-xs">
                  {a.model} · {a.outcome} ·{" "}
                  {a.costUsd === undefined ? "cost unknown" : `$${a.costUsd.toFixed(5)}`} ·{" "}
                  {a.requestId ?? "no request ID"}
                  {a.reusedFrom ? " · reused exact content" : ""}
                </p>
                {a.usage ? (
                  <p className="font-mono text-xs text-muted">
                    {a.usage.inputTokens} input · {a.usage.outputTokens} billed output (includes{" "}
                    {a.usage.reasoningTokens} reasoning) · {a.usage.cachedInputTokens} cached input
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    Token usage unavailable; the planning reservation remains separate from known
                    cost.
                  </p>
                )}
                <pre className="slide-source whitespace-pre-wrap break-words font-mono text-xs">
                  {a.extraction
                    ? JSON.stringify(a.extraction, null, 2)
                    : (a.partialText ?? a.error?.message)}
                </pre>
                {a.outcome === "completed" ? (
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...state,
                        acceptedAttemptIds: { ...state.acceptedAttemptIds, [a.cropId]: a.id },
                      })
                    }
                  >
                    Use this source version · keep manual edits
                  </Button>
                ) : null}
              </div>
            ))}
            <pre className="slide-source whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(state.edits, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </section>
  );
}
