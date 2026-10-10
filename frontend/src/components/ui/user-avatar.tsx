"use client";

import { useEffect, useRef, useState } from "react";
import BoringAvatar from "boring-avatars";
import { cn } from "@/lib/utils";
import { mediaObjectKey } from "@/lib/media";

const AVATAR_COLORS = ["#7d6df2", "#0f9b8e", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#65a30d", "#f59e0b"];
export { AVATAR_COLORS };

export type AvatarVariantName = "marble" | "beam" | "pixel" | "sunset" | "ring" | "bauhaus";

export const AVATAR_VARIANTS: { name: AvatarVariantName; label: string }[] = [
  { name: "marble", label: "مرمر" },
  { name: "beam", label: "بیم" },
  { name: "pixel", label: "پیکسلی" },
  { name: "sunset", label: "غروب" },
  { name: "ring", label: "حلقه" },
  { name: "bauhaus", label: "باهاوس" },
];

/** Same palettes the avatar studio offers, reused for the wide profile banner. */
export const AVATAR_PALETTES: { label: string; colors: string[] }[] = [
  { label: "پیش‌فرض", colors: AVATAR_COLORS },
  { label: "رزین", colors: ["#0f172a", "#38bdf8", "#f0abfc", "#a5f3fc", "#7c3aed", "#f5d0fe"] },
  { label: "صحرایی", colors: ["#1c1917", "#fbbf24", "#fb923c", "#fde68a", "#f97316", "#fed7aa"] },
  { label: "اسکاندی", colors: ["#022c22", "#34d399", "#fef3c7", "#a7f3d0", "#166534", "#d1fae5"] },
  { label: "نئون", colors: ["#18181b", "#a3e635", "#22d3ee", "#f97316", "#e879f9", "#fb7185"] },
  { label: "سلطنتی", colors: ["#20123a", "#9370db", "#e6e6fa", "#6b21a8", "#c084fc", "#f3e8ff"] },
];

export function avatarPaletteOf(raw?: string): string[] {
  if (!raw || !raw.startsWith("[")) return AVATAR_COLORS;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.length >= 2 && v.every((c) => typeof c === "string")) return v.slice(0, 6);
  } catch {}
  return AVATAR_COLORS;
}

type AvatarOwner = {
  avatarVariant?: AvatarVariantName;
  avatarPalette?: string;
  avatarPhoto?: string;
} | null | undefined;

export function avatarPropsOf(u: AvatarOwner): { src: string | null; variant: AvatarVariantName; palette: string[] } {
  return {
    src: u?.avatarPhoto ?? null,
    variant: u?.avatarVariant ?? "beam",
    palette: avatarPaletteOf(u?.avatarPalette),
  };
}

function useSettledPhoto(src?: string | null): string | null {
  const [painted, setPainted] = useState<string | null>(null);
  const paintedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!src) {
      paintedRef.current = null;
      setPainted(null);
      return;
    }
    if (src === paintedRef.current) return;
    let cancel = false;
    const img = new Image();
    img.onload = () => {
      if (cancel) return;
      paintedRef.current = src;
      setPainted(src);
    };
    img.onerror = () => {
      if (cancel) return;
      if (mediaObjectKey(src) !== mediaObjectKey(paintedRef.current)) {
        paintedRef.current = null;
        setPainted(null);
      }
    };
    img.src = src;
    return () => {
      cancel = true;
    };
  }, [src]);

  return painted;
}

export function UserAvatar({
  name,
  src,
  variant = "beam",
  palette,
  className,
}: {
  name: string;
  src?: string | null;
  variant?: AvatarVariantName;
  palette?: string[];
  className?: string;
}) {
  const painted = useSettledPhoto(src);
  if (painted) {
    return (
      <span
        className={cn(
          "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-background ring-1 ring-black/5 dark:ring-white/10",
          className
        )}
      >
        <img src={painted} alt={name} className="h-full w-full object-cover" draggable={false} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-background ring-1 ring-black/5 dark:ring-white/10",
        className
      )}
    >
      <BoringAvatar name={name} variant={variant} colors={palette ?? AVATAR_COLORS} size="100%" title={false} />
    </span>
  );
}