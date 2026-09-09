import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[color,background-color,box-shadow,transform,opacity] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 active:enabled:scale-96 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent-hover",
        secondary: "border border-border bg-panel text-fg hover:bg-panel-2",
        outline: "border border-border bg-transparent text-fg hover:bg-panel-2",
        ghost: "text-muted hover:bg-panel-2 hover:text-fg",
        danger: "bg-danger/15 text-danger hover:bg-danger/25",
      },
      size: {
        default: "h-11 min-h-11 px-4 text-sm",
        sm: "h-9 min-h-9 px-3 text-sm",
        lg: "h-11 min-h-11 px-5 text-sm sm:h-12 sm:min-h-12",
        wrap: "h-auto min-h-11 px-3 py-2 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
