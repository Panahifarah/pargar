"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/reveal";

export function Panel({
  title,
  description,
  icon,
  tint = "bg-primary/10 text-primary",
  actions,
  children,
  className,
  bodyClassName,
  delay = 0,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
}) {
  return (
    <Reveal className={className} delay={delay}>
      <section className="card-hover overflow-hidden rounded-2xl border-2 border-border bg-card">
        {(title || actions) && (
          <header className="flex flex-wrap items-start gap-3 border-b border-border/70 px-5 py-4 sm:px-6">
            {icon && (
              <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tint)}>
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-base font-bold leading-snug">{title}</h2>}
              {description && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">{description}</p>
              )}
            </div>
            {actions && (
              <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:ms-auto sm:w-auto sm:justify-end">
                {actions}
              </div>
            )}
          </header>
        )}
        <div className={cn("p-5 sm:p-6", bodyClassName)}>{children}</div>
      </section>
    </Reveal>
  );
}