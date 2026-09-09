import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_MODES, type ThemeMode, useThemeStore } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

const LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="seg-track shrink-0"
    >
      {THEME_MODES.map((id) => {
        const Icon = ICONS[id];
        const on = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={LABELS[id]}
            title={LABELS[id]}
            onClick={() => setMode(id)}
            className={cn("seg-item seg-item-sm", on && "seg-item-on")}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{LABELS[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
