"use client";

import type { Role, User } from "./types";

/** Absolute student cap. A heart returns on the server every few hours. */
export const MAX_HEARTS = 5;

/** Infinity glyph for staff heart display. */
export const INFINITE_HEARTS_LABEL = "∞";

export function hasInfiniteHearts(role: Role | string | null | undefined): boolean {
  return role === "admin" || role === "mentor";
}

export function clampHearts(hearts: number | null | undefined): number {
  if (hearts == null || Number.isNaN(hearts)) {
    return MAX_HEARTS;
  }
  return Math.max(0, Math.min(MAX_HEARTS, hearts));
}

/** Effective hearts from the server user — never invents a timed refill. */
export function heartsOf(user: User | null | undefined): number {
  return clampHearts(user?.hearts);
}

export function formatHeartsDisplay(user: User | null | undefined): string {
  if (hasInfiniteHearts(user?.role)) {
    return INFINITE_HEARTS_LABEL;
  }
  return String(clampHearts(user?.hearts));
}
