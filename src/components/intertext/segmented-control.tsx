import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = {
  id: T;
  label: ReactNode;
  ariaLabel?: string;
};

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  disabled,
  className,
  itemClassName,
}: {
  value: T;
  onChange: (id: T) => void;
  options: SegmentOption<T>[];
  "aria-label": string;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("seg-track", className)}>
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={opt.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn("seg-item", itemClassName, on && "seg-item-on")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
