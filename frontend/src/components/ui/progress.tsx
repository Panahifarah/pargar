"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  gradient?: boolean;
  /** Softer fill motion for verified-watch / long jumps. */
  smooth?: boolean;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, gradient, smooth, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, value));
    return (
      <div
        ref={ref}
        className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}
        {...props}
      >
        <div
          className={cn(
            "h-full rounded-full will-change-[width] rtl:me-auto",
            gradient ? "bg-primary" : "bg-primary",
            smooth
              ? "transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
              : "transition-[width] duration-300 ease-out"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
