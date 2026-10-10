"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function isVerifiedRole(role?: string | null): boolean {
  return role === "admin" || role === "mentor";
}

function roleLabel(role?: string | null): string | null {
  if (role === "admin") return "ادمین";
  if (role === "mentor") return "منتور";
  return null;
}

/** Seal sized just under the surrounding name's cap height. Hover and focus show the role. */
export function VerifiedBadge({ role, className }: { role?: string | null; className?: string }) {
  const label = roleLabel(role);
  const tipId = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [focusable, setFocusable] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; below: boolean } | null>(null);

  useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    setFocusable(!el.closest("button, a, [role='button']"));
  }, []);

  const place = () => {
    const el = anchor.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = rect.top < 36;
    setBox({
      left: rect.left + rect.width / 2,
      top: below ? rect.bottom : rect.top,
      below,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const show = (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    place();
    setOpen(true);
  };

  const scheduleHide = () => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), 60);
  };

  if (!label) return null;

  return (
    <>
      <span
        ref={anchor}
        tabIndex={focusable ? 0 : undefined}
        className="pointer-events-auto inline-flex shrink-0 cursor-default items-center rounded-sm leading-none outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        onFocus={() => show()}
        onBlur={() => setOpen(false)}
        aria-describedby={open ? tipId : undefined}
      >
        <BadgeCheck
          aria-hidden={false}
          role="img"
          aria-label="تأییدشده"
          className={cn("size-[0.85em] text-sky-500", className)}
        />
      </span>
      {open && box
        ? createPortal(
            <span
              style={{
                position: "fixed",
                left: box.left,
                top: box.below ? box.top - 4 : box.top + 4,
                transform: box.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
                paddingTop: box.below ? 8 : 0,
                paddingBottom: box.below ? 0 : 8,
              }}
              className="pointer-events-auto z-[200]"
              onPointerEnter={show}
              onPointerLeave={scheduleHide}
            >
              <span
                id={tipId}
                role="tooltip"
                className="block whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-bold text-popover-foreground shadow-md"
              >
                {label}
              </span>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
