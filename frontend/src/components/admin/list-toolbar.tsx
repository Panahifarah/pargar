import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Shared chrome for admin list search / filter rows. */
export function ListToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 border-b border-border pb-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Native select styled to match Input height and radius. */
export function AdminSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-11 rounded-lg border border-input bg-card px-3 font-sans text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
