import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <section
    data-slot="card"
    className={cn(
      "bg-card text-card-foreground ring-foreground/10 overflow-hidden rounded-2xl ring-1",
      className,
    )}
    {...props}
  />
);

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <header data-slot="card-header" className={cn("space-y-1 px-4 py-4", className)} {...props} />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h2
    data-slot="card-title"
    className={cn("text-base leading-snug font-semibold tracking-tight", className)}
    {...props}
  />
);

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p
    data-slot="card-description"
    className={cn("text-muted-foreground text-sm leading-relaxed", className)}
    {...props}
  />
);

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div data-slot="card-content" className={cn("px-4 pb-4", className)} {...props} />
);

export const CardFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <footer
    data-slot="card-footer"
    className={cn("bg-muted/50 border-border border-t px-4 py-3", className)}
    {...props}
  />
);
