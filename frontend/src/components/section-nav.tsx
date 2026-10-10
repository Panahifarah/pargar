"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionNavItem<T extends string = string> = {
  id: T;
  label: string;
};

export type SectionNavGroup<T extends string = string> = {
  title?: string;
  items: SectionNavItem<T>[];
};

const DESKTOP_STICKY_TOP = 80;

export function SectionColumns({ children }: { children: ReactNode }) {
  return (
    <div className="sm:grid sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-start sm:gap-8">
      {children}
    </div>
  );
}

export function SectionNav<T extends string>({
  label,
  groups,
  activeId,
  onSelect,
}: {
  label: string;
  groups: SectionNavGroup<T>[];
  activeId: T;
  onSelect: (id: T) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [stick, setStick] = useState(false);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => {
      const desktop = window.matchMedia("(min-width: 640px)").matches;
      setStick(desktop && el.offsetHeight <= window.innerHeight - DESKTOP_STICKY_TOP);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={cn(
        "z-20 -mx-1 mb-4 flex gap-2 bg-background/95 px-1 py-2 backdrop-blur max-sm:sticky max-sm:top-16 max-sm:overflow-x-auto",
        "sm:z-10 sm:mx-0 sm:mb-0 sm:flex-col sm:gap-3 sm:self-start sm:overflow-visible sm:rounded-2xl sm:border-2 sm:border-border sm:bg-card sm:p-2 sm:backdrop-blur-none",
        stick && "sm:sticky sm:top-20",
      )}
    >
      {groups.map((group) => (
        <div
          key={group.title ?? group.items[0]?.id ?? "group"}
          className="contents sm:flex sm:flex-col sm:gap-1"
        >
          {group.title ? (
            <p className="hidden px-3 pt-2 text-sm font-bold text-muted-foreground sm:block">{group.title}</p>
          ) : null}
          {group.items.map((item) => {
            const selected = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "sm:w-full sm:rounded-xl sm:px-3 sm:py-2 sm:text-start",
                  selected
                    ? "border-primary bg-primary text-primary-foreground sm:border-transparent sm:bg-primary/10 sm:text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground sm:border-transparent sm:bg-transparent",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SectionPanel({
  id,
  titleId,
  title,
  description,
  children,
}: {
  id?: string;
  titleId: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={titleId} className="min-w-0 rounded-2xl border-2 border-border bg-card">
      <header className="border-b border-border/70 px-5 py-4 sm:px-6">
        <h2 id={titleId} className="text-lg font-black">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
