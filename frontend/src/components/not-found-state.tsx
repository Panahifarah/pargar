import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

const PERSIAN_LETTER = /[\u0600-\u06FF]/;

/** Keep a short Persian sentence. Drop blank, English, trace-like text, and a copy of the title. */
export function notFoundSentence(
  candidate: string | null | undefined,
  fallback: string,
  title?: string,
): string {
  const msg = candidate?.replace(/\s+/g, " ").trim() ?? "";
  if (!msg || msg.length > 180 || !PERSIAN_LETTER.test(msg)) return fallback;
  if (title && msg === title.trim()) return fallback;
  if (/stack trace|uncaught|typeerror|referenceerror|at \S+\(/i.test(msg)) return fallback;
  return msg;
}

export function NotFoundState({
  title,
  description,
  href,
  actionLabel,
  icon: Icon = SearchX,
}: {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="mx-auto w-full max-w-lg py-6 sm:py-10">
      <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center sm:px-10 sm:py-16">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </div>
        <h1 className="mt-6 text-xl font-black tracking-tight sm:text-2xl">{title}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
        <Button asChild className="mt-8">
          <Link href={href}>{actionLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
