"use client";

import { useRouter } from "next/navigation";
import {
  Book,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Cpu,
  Flag,
  Globe,
  Layers,
  Lock,
  PlayCircle,
  Rocket,
  RotateCcw,
  Target,
  Terminal,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { TreeChapter, TreeData, TreeLesson } from "@/lib/types";
import { cn, formatFaNumber } from "@/lib/utils";

const CHAPTER_ICONS: Record<string, typeof Terminal> = {
  terminal: Terminal,
  chip: Cpu,
  rocket: Rocket,
  book: Book,
  layers: Layers,
  flag: Flag,
  target: Target,
  zap: Zap,
  code: Terminal,
  globe: Globe,
};

export function SkillTree({ data, onSelect }: { data: TreeData; onSelect?: (id: number) => void }) {
  const router = useRouter();

  const chapters = useMemo(() => [...data.chapters].sort((a, b) => a.sortOrder - b.sortOrder), [data]);
  const byId = useMemo(() => {
    const map = new Map<number, TreeLesson>();
    chapters.forEach((ch) => (ch.lessons ?? []).forEach((l) => map.set(l.id, l)));
    return map;
  }, [chapters]);

  const all = useMemo(() => chapters.flatMap((ch) => ch.lessons ?? []), [chapters]);
  const completed = all.filter((l) => l.progress?.passedQuiz).length;

  // system default: chapters with remaining actionable lessons are open
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const s = new Set<number>();
    chapters.forEach((ch) => {
      if ((ch.lessons ?? []).some((l) => !l.locked && !l.progress?.passedQuiz)) s.add(ch.id);
    });
    return s;
  });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-2xl border-2 border-border bg-background p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Terminal className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-black tracking-tight">نقشهٔ مسیر</h2>
            <p className="text-xs text-muted-foreground">
              {completed}/{all.length} درس تکمیل‌شده · {all.length - completed} باقی‌مانده
            </p>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted sm:w-56">
          <div
            className="h-full rounded-full bg-gradient-to-l from-primary to-primary/60"
            style={{ width: `${all.length ? Math.max((completed / all.length) * 100, 2) : 0}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {chapters.map((ch) => (
          <ChapterRow
            key={ch.id}
            ch={ch}
            byId={byId}
            open={expanded.has(ch.id)}
            onToggle={() => toggle(ch.id)}
            onSelect={onSelect ?? ((id: number) => router.push(`/player/${id}`))}
          />
        ))}
      </div>
    </div>
  );
}

function ChapterRow({
  ch,
  byId,
  open,
  onToggle,
  onSelect,
}: {
  ch: TreeChapter;
  byId: Map<number, TreeLesson>;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: number) => void;
}) {
  const lessons = [...(ch.lessons ?? [])].sort((a, b) => a.y - b.y || a.x - b.x);
  const done = lessons.filter((l) => l.progress?.passedQuiz).length;
  const isComplete = done === lessons.length;
  const Icon = CHAPTER_ICONS[ch.icon] ?? Terminal;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border-2 bg-card transition-colors duration-300",
        isComplete ? "border-success/40" : open ? "border-primary/50" : "border-border hover:border-primary/40"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-start"
        aria-expanded={open}
      >
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", isComplete ? "bg-success/10 text-success" : "bg-primary/10 text-primary")}>
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-extrabold">{ch.title}</h3>
            {isComplete && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> کامل شد
              </span>
            )}
            <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground sm:inline-block">
              هفتهٔ {ch.sortOrder}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">{ch.description}</p>
        </div>

        <div className="shrink-0 text-end">
          <p className="text-xs font-bold text-muted-foreground">
            <span className="font-black text-foreground">{done}</span>/{lessons.length} درس
          </p>
          <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", isComplete ? "bg-success" : "bg-primary")}
              style={{ width: `${lessons.length ? Math.max((done / lessons.length) * 100, 3) : 0}%` }}
            />
          </div>
        </div>

        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>

      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="grid gap-2.5 border-t-2 border-border/70 p-4 sm:grid-cols-2">
            {lessons.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} byId={byId} onSelect={onSelect} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LessonRow({
  lesson,
  byId,
  onSelect,
}: {
  lesson: TreeLesson;
  byId: Map<number, TreeLesson>;
  onSelect: (id: number) => void;
}) {
  const passed = !!lesson.progress?.passedQuiz;
  const locked = lesson.locked;
  const inProgress = !locked && !passed && (lesson.progress?.watchedPct ?? 0) > 0;
  const ready = !locked && !passed && !!lesson.progress?.quizUnlocked;
  const retry = lesson.quizStatus === "failed";
  const pct = lesson.progress?.watchedPct ?? 0;

  const prereq = lesson.requiresLessonId ? byId.get(lesson.requiresLessonId) : undefined;

  const s = locked
    ? {
        row: "border-dashed border-border/80 bg-muted/30",
        chip: "bg-muted text-muted-foreground",
        pill: "bg-foreground/5 text-muted-foreground",
        pillText: "قفل",
        muted: true,
      }
    : passed
      ? { row: "border-success/50 bg-success/5", chip: "bg-success text-success-foreground", pill: "bg-success/10 text-success", pillText: "تکمیل شده", muted: false }
      : retry
        ? { row: "border-accent/50 bg-accent/5", chip: "bg-accent text-accent-foreground", pill: "bg-accent/10 text-accent", pillText: "تلاش مجدد آزمون", muted: false }
        : ready
          ? { row: "border-primary/60 bg-primary/5", chip: "bg-primary text-primary-foreground", pill: "bg-gold/10 text-gold", pillText: "آمادهٔ آزمون", muted: false }
          : inProgress
            ? { row: "border-primary/40 bg-card", chip: "bg-primary/10 text-primary", pill: "bg-primary/10 text-primary", pillText: `${Math.round(pct)}٪ تماشا شده`, muted: false }
            : { row: "border-border bg-card", chip: "bg-muted text-foreground", pill: "bg-muted/70 text-muted-foreground", pillText: `${formatFaNumber(lesson.durationSeconds)} ثانیه · ${formatFaNumber(lesson.xpReward)} امتیاز`, muted: false };

  return (
    <div
      role={locked ? undefined : "button"}
      tabIndex={locked ? undefined : 0}
      className={cn(
        "group flex items-center gap-3 rounded-xl border-2 p-3 transition-colors duration-300",
        locked ? "cursor-default" : "cursor-pointer hover:border-primary/50",
        s.row
      )}
      onClick={() => {
        if (!locked) onSelect(lesson.id);
      }}
      onKeyDown={(e) => {
        if (locked) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(lesson.id);
        }
      }}
    >
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg">
        {(ready || retry) && <span className="absolute inline-flex h-full w-full animate-ping rounded-lg bg-primary/25" />}
        <span className={cn("relative grid h-9 w-9 place-items-center rounded-lg", s.chip)}>
          {locked ? <Lock className="h-4 w-4" /> : passed ? <CheckCircle2 className="h-5 w-5" /> : retry ? <RotateCcw className="h-4 w-4" /> : ready ? <BookOpenCheck className="h-4 w-4" /> : <PlayCircle className="h-5 w-5" />}
        </span>
      </span>

      <div className={cn("min-w-0 flex-1", s.muted && "opacity-80")}>
        <div className="flex items-center justify-between gap-2">
          <p className={cn("truncate text-sm font-bold", locked && "text-muted-foreground")}>{lesson.title}</p>
          {!locked && !passed && (
            <span className="shrink-0 text-[11px] font-black tabular-nums text-muted-foreground/70">+{formatFaNumber(lesson.xpReward)} امتیاز</span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", s.pill)}>{s.pillText}</span>
          {inProgress && (
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          )}
          {locked && prereq && (
            <span className="text-[11px] leading-snug text-muted-foreground">
              بعد از تکمیل «{prereq.title}»
            </span>
          )}
        </div>
      </div>

      {locked ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
      ) : (
        <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:-translate-x-0.5" />
      )}
    </div>
  );
}