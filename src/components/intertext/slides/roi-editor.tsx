import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FULL_CORNERS } from "@/lib/intertext/slides/config";
import { validCorners } from "@/lib/intertext/slides/roi";
import type { Corners } from "@/lib/intertext/slides/types";
const NAMES = ["Top left", "Top right", "Bottom right", "Bottom left"];
export function RoiEditor({
  original,
  corrected,
  corners,
  onChange,
  disabled,
}: {
  original?: string;
  corrected?: string;
  corners: Corners;
  onChange: (value: Corners) => void;
  disabled: boolean;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const update = (i: number, axis: "x" | "y", value: number) => {
    const next = structuredClone(corners);
    next[i]![axis] = Math.max(0, Math.min(1, value));
    onChange(next);
  };
  return (
    <section aria-label="Slide region editor" className="space-y-3">
      <p className="text-sm font-medium">Slide region · four-corner perspective</p>
      <p className="text-xs text-muted">
        Drag each numbered corner or enter percentages. Include footnotes and slide edges. Compare
        the original with the corrected region; camera movement needs a new ROI keyframe.
      </p>
      {original ? (
        <div
          ref={area}
          className="slide-roi relative touch-none overflow-hidden rounded-lg border border-border"
          onPointerMove={(e) => {
            if (drag === null || disabled) return;
            const rect = area.current!.getBoundingClientRect();
            const next = structuredClone(corners);
            next[drag] = {
              x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
              y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
            };
            onChange(next);
          }}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        >
          <img
            src={original}
            alt="Original video frame for region comparison"
            className="block w-full"
          />
          {corners.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Drag ${NAMES[i]} corner`}
              disabled={disabled}
              className="roi-corner absolute flex size-11 items-center justify-center rounded-full border-2 border-accent bg-panel font-mono text-accent shadow-sm"
              style={{
                left: `calc(${p.x * 100}% + ${(0.5 - p.x) * 44}px)`,
                top: `calc(${p.y * 100}% + ${(0.5 - p.y) * 44}px)`,
                transform: "translate(-50%, -50%)",
              }}
              onPointerDown={(e) => {
                e.currentTarget.parentElement!.setPointerCapture(e.pointerId);
                setDrag(i);
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {corners.map((p, i) => (
          <div key={i} className="space-y-1">
            <span className="text-xs text-muted">
              {i + 1}. {NAMES[i]}
            </span>
            {(["x", "y"] as const).map((axis) => (
              <label key={axis} className="flex items-center gap-1 text-xs">
                <span>{axis.toUpperCase()} %</span>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  aria-label={`${NAMES[i]} ${axis} percent`}
                  value={Math.round(p[axis] * 1000) / 10}
                  disabled={disabled}
                  onChange={(e) => update(i, axis, Number(e.target.value) / 100)}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => onChange(structuredClone(FULL_CORNERS))}
      >
        Reset to original frame
      </Button>
      {!validCorners(corners) ? (
        <p role="alert" className="text-sm text-danger">
          Corners must form a clockwise convex region.
        </p>
      ) : null}
      {corrected ? (
        <img
          src={corrected}
          alt="Perspective-corrected slide region"
          className="max-h-80 w-full rounded-lg border border-border object-contain"
        />
      ) : null}
    </section>
  );
}
