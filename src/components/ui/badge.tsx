import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "ok" | "danger";
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide",
        tone === "neutral" && "border-border bg-panel-2 text-muted",
        tone === "accent" && "border-accent/25 bg-accent/10 text-accent-text",
        tone === "ok" && "border-ok/25 bg-ok/10 text-ok",
        tone === "danger" && "border-danger/25 bg-danger/10 text-danger",
        className,
      )}
      {...props}
    />
  );
}
