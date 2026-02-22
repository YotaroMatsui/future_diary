import type { InputHTMLAttributes } from "react";
import { cn } from "./utils";

export const Input = ({ className, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    type={type}
    data-slot="input"
    className={cn(
      "border-input bg-background h-10 w-full rounded-lg border px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);
