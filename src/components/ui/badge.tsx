import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "ok" | "danger";
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tracking-wide",
        tone === "neutral" && "bg-panel-2 text-muted",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "danger" && "bg-danger/15 text-danger",
        className,
      )}
      {...props}
    />
  );
}
