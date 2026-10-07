"use client";

import { Heart, Infinity as InfinityIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_HEARTS, clampHearts } from "@/lib/hearts";

export function HeartsMeter({
  hearts,
  size = "md",
  infinite = false,
}: {
  hearts: number;
  size?: "sm" | "md" | "lg";
  infinite?: boolean;
}) {
  const dims = size === "lg" ? "h-9 w-9" : size === "sm" ? "h-5 w-5" : "h-7 w-7";
  if (infinite) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 font-black text-primary",
          size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-lg"
        )}
        title="جان نامحدود"
        aria-label="جان نامحدود"
      >
        <Heart className={cn(dims, "fill-rose-500 text-rose-500")} />
        <InfinityIcon className={cn(dims, "text-primary")} strokeWidth={2.5} />
      </span>
    );
  }
  const n = clampHearts(hearts);
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: MAX_HEARTS }, (_, i) => {
        const on = i < n;
        return (
          <Heart
            key={i}
            className={cn(
              dims,
              "transition-transform duration-200",
              on
                ? cn("fill-rose-500 text-rose-500", n === 1 && "animate-pulse-soft")
                : "text-muted-foreground/40"
            )}
          />
        );
      })}
    </div>
  );
}
