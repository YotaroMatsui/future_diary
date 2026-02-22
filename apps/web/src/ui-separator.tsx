import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export const Separator = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="separator"
    role="separator"
    className={cn("bg-border h-px w-full", className)}
    {...props}
  />
);
