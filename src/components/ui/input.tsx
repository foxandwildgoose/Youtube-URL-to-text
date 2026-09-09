import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 min-h-12 w-full rounded-md border border-border bg-panel px-4 text-base text-fg transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-subtle",
        "focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
