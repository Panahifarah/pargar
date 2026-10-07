"use client";

import BoringAvatar from "boring-avatars";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

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
  if (src) {
    return (
      <Avatar className={cn("ring-1 ring-black/5 dark:ring-white/10", className)}>
        <AvatarImage src={src} alt={name} />
        <AvatarFallback />
      </Avatar>
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