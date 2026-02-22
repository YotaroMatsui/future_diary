import type { TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    data-slot="textarea"
    className={cn(
      "border-input bg-background min-h-48 w-full rounded-xl border px-3 py-2 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);
