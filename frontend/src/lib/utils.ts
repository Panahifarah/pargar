import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatWinHWin(v: number, digits = 0) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: digits }).format(v);
}

export function formatFaNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: digits }).format(value);
}

/** Streak label — never use a hyphen (۰-روزه looks like a negative). */
export function formatStreakLabel(days: number) {
  const n = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  return `${formatFaNumber(n)} روز`;
}

/** Quiz option letters: الف، ب، ج، د، … */
const FA_OPTION_LETTERS = ["الف", "ب", "ج", "د", "ه", "و"] as const;

/** Jalali day plus clock, for conversation rows. */
export function formatJalaliStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const day = new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day} · ${time}`;
}

export function formatOptionLetter(index: number): string {
  if (index >= 0 && index < FA_OPTION_LETTERS.length) {
    return FA_OPTION_LETTERS[index];
  }
  return formatFaNumber(index + 1);
}