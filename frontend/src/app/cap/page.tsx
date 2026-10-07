"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useRef } from "react";
import {
  Award,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  CalendarDays,
  Flame,
  Heart,
  Lock,
  MessageSquare,
  Package,
  PlayCircle,
  Sparkles,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { SkillTree } from "@/components/skill-tree";
import { Skeleton } from "@/components/ui/skeleton";
import { http, toUserError } from "@/lib/api";
import type { Certificate, CertificatePhysicalOrder, MeetingEvent, PhysicalCertSettings, TreeData, TreeLesson } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-store";
import { cn, formatFaNumber, formatStreakLabel } from "@/lib/utils";
import { clampHearts, hasInfiniteHearts, INFINITE_HEARTS_LABEL, MAX_HEARTS } from "@/lib/hearts";
import { toast } from "@/components/providers";

export default function CapPage() {
  return (
    <Suspense fallback={<CapSkeleton />}>
      <CapPageInner />
    </Suspense>
  );
}

function CapPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tree"],
    queryFn: () => http.get<TreeData>("/api/tree"),
    refetchInterval: 60_000,
  });

  const { data: eventsData } = useQuery({
    queryKey: ["events", "upcoming-cap"],
    queryFn: () => http.get<{ events: MeetingEvent[] }>("/api/events"),
    staleTime: 60_000,
  });

  const allLessons = (data?.chapters ?? []).flatMap((ch) => ch.lessons ?? []);
  const completedCount = allLessons.filter((l) => l.progress?.passedQuiz).length;
  const curriculumDone = allLessons.length > 0 && completedCount === allLessons.length;

  useEffect(() => {
    const lesson = params.get("lesson");
    if (lesson && rootRef.current) {
      rootRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [params]);

  const { data: certData } = useQuery({
    queryKey: ["me", "certificate"],
    queryFn: () =>
      http.get<{
        certificate: Certificate | null;
        physicalOrder: CertificatePhysicalOrder | null;
        physical: PhysicalCertSettings;
      }>("/api/me/certificate"),
    enabled: !!user && curriculumDone,
  });

  useEffect(() => {
    if (!curriculumDone || !user) return;
    void http
      .post("/api/me/certificate/issue", {})
      .then(() => qc.invalidateQueries({ queryKey: ["me", "certificate"] }))
      .catch((e) => toast.error(toUserError(e, "صدور گواهینامه ممکن نشد")));
  }, [curriculumDone, user, qc]);

  if (isLoading) {
    return <CapSkeleton />;
  }

  const me = data?.me;
  const all = allLessons;
  const lockedCount = all.filter((l) => l.locked).length;
  const inProgress = all.filter(
    (l) => !l.locked && !l.progress?.passedQuiz && (l.progress?.watchedPct ?? 0) > 0 && !l.progress?.quizUnlocked,
  );
  const readyQuiz = all.filter((l) => !l.locked && !l.progress?.passedQuiz && !!l.progress?.quizUnlocked);
  const openAndNew = all.filter((l) => !l.locked && !l.progress?.passedQuiz);
  const firstLocked = all.find((l) => l.locked);
  const done = curriculumDone;

  const pct = all.length ? Math.round((completedCount / all.length) * 100) : 0;
  const hearts = clampHearts(me?.hearts ?? user?.hearts ?? MAX_HEARTS);
  const lowHearts = !hasInfiniteHearts(user?.role) && hearts > 0 && hearts <= 1;
  const nextEvent = (eventsData?.events ?? [])[0];
  const physicalOpen =
    done &&
    certData?.physical?.enabled &&
    !!certData.certificate &&
    (!certData.physicalOrder || certData.physicalOrder.status === "cancelled") &&
    (!certData.certificate.issuedAt ||
      Date.now() <
        new Date(certData.certificate.issuedAt).getTime() +
          (certData.physical.windowDays || 30) * 24 * 60 * 60 * 1000);

  const next = nextAction(inProgress, readyQuiz, openAndNew, firstLocked, done);

  return (
    <div className="space-y-8" ref={rootRef}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-kicker">مسیر شما</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">
            درخت <span className="text-primary">مهارت</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            الان روی گام بعدی تمرکز کنید — تماشا، آزمون، رویداد یا گواهینامه.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1.5 text-sm font-bold text-accent">
            <Flame className="h-4 w-4" /> {formatStreakLabel(me?.streak ?? user?.streakCurrent ?? 0)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1.5 text-sm font-bold text-gold">
            <Sparkles className="h-4 w-4" /> {formatFaNumber(me?.xp ?? user?.xp ?? 0)} امتیاز
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold",
              lowHearts ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary",
            )}
          >
            <Heart className="h-4 w-4 fill-current" />{" "}
            {hasInfiniteHearts(user?.role)
              ? `${INFINITE_HEARTS_LABEL} جان`
              : `${formatFaNumber(hearts)} جان`}
          </span>
        </div>
      </div>

      {lowHearts && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-destructive/30 bg-destructive/5 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-extrabold text-destructive">فقط {formatFaNumber(hearts)} جان مانده</p>
              <p className="text-xs text-muted-foreground">
                یک اشتباه دیگر حساب را قفل می‌کند. قبل از آزمون مطمئن شوید؛ اگر گیر کردید با منتور حرف بزنید.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("pargar:chat", { detail: { open: true } }))
            }
          >
            <MessageSquare className="h-4 w-4" /> منتور
          </Button>
        </div>
      )}

      {done && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-primary/30 bg-primary/5 px-5 py-4">
          <div>
            <p className="text-sm font-extrabold">دوره را تمام کردید</p>
            <p className="text-xs text-muted-foreground">
              گواهینامه دیجیتال آماده است
              {physicalOpen ? " — می‌توانید نسخه فیزیکی هم درخواست کنید." : "."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const id = certData?.certificate?.publicId;
                if (id) router.push(`/c/${id}`);
                else {
                  void http
                    .post<{ certificate: { publicId: string } }>("/api/me/certificate/issue", {})
                    .then((r) => {
                      if (r.certificate?.publicId) router.push(`/c/${r.certificate.publicId}`);
                    })
                    .catch((e) => toast.error(toUserError(e, "صدور گواهینامه ممکن نشد")));
                }
              }}
            >
              <Award className="h-4 w-4" /> مشاهده گواهینامه
            </Button>
            {physicalOpen && certData?.certificate?.publicId && (
              <Button variant="outline" onClick={() => router.push(`/c/${certData.certificate!.publicId}`)}>
                <Package className="h-4 w-4" /> نسخه فیزیکی
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-5">
        <div className="rounded-2xl border-2 border-border bg-card p-5 shadow-offset-sm md:col-span-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-extrabold">
              <TrendingUp className="h-4 w-4 text-primary" /> پیشرفت کل
            </p>
            <span className="text-2xl font-black tabular-nums text-primary">{pct}٪</span>
          </div>
          <div className="mt-3 h-3.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-success/10 px-2 py-2.5">
              <p className="text-lg font-black text-success">{completedCount}</p>
              <p className="text-[11px] font-bold text-muted-foreground">تکمیل‌شده</p>
            </div>
            <div className="rounded-xl bg-primary/10 px-2 py-2.5">
              <p className="text-lg font-black text-primary">{inProgress.length}</p>
              <p className="text-[11px] font-bold text-muted-foreground">در جریان</p>
            </div>
            <div className="rounded-xl bg-muted px-2 py-2.5">
              <p className="text-lg font-black text-muted-foreground">{lockedCount}</p>
              <p className="text-[11px] font-bold text-muted-foreground">قفل‌شده</p>
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            {(data?.chapters ?? []).map((ch) => {
              const chDone = ch.lessons.filter((l) => l.progress?.passedQuiz).length;
              return (
                <div key={ch.id} className="flex items-center justify-between text-xs">
                  <span className="font-bold text-muted-foreground">{ch.title}</span>
                  <span
                    className={cn(
                      "font-black tabular-nums",
                      chDone === ch.lessons.length ? "text-success" : "text-foreground",
                    )}
                  >
                    {chDone}/{ch.lessons.length}
                  </span>
                </div>
              );
            })}
          </div>
          {nextEvent && (
            <button
              type="button"
              onClick={() => router.push("/unwrap?tab=events")}
              className="mt-4 flex w-full items-start gap-2 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-start transition hover:border-primary/40"
            >
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-[10px] font-extrabold text-primary">رویداد نزدیک</span>
                <span className="block truncate text-xs font-bold">{nextEvent.title}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {new Date(nextEvent.startsAt).toLocaleString("fa-IR")}
                </span>
              </span>
            </button>
          )}
        </div>

        <div
          className={cn(
            "flex flex-col justify-between rounded-2xl border-2 p-5 md:col-span-3",
            next.locked
              ? "border-border bg-muted/40"
              : "border-primary/40 bg-primary/5"
          )}
        >
          <p
            className={cn(
              "flex items-center gap-2 text-xs font-extrabold tracking-wider",
              next.locked ? "text-muted-foreground" : "text-primary"
            )}
          >
            {next.locked ? <Lock className="h-4 w-4" /> : <ZapIcon className="h-4 w-4" />}
            {next.locked ? "هنوز قفل است" : "گام بعدی شما"}
          </p>
          <div className="mt-3 flex flex-1 flex-col items-start justify-center">
            <h2 className="text-xl font-black leading-snug sm:text-2xl">{next.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{next.desc}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {next.cta ? (
              <Button size="lg" onClick={() => router.push(next.cta!)} className="gap-2">
                {next.icon} {next.label}
              </Button>
            ) : next.prereqId ? (
              <Button size="lg" variant="secondary" onClick={() => router.push(`/player/${next.prereqId}`)} className="gap-2">
                <PlayCircle className="h-5 w-5" /> رفتن به پیش‌نیاز
              </Button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-xl bg-muted px-3.5 py-2.5 text-sm font-bold text-muted-foreground">
                <Lock className="h-4 w-4" /> ابتدا درس پیش‌نیاز را کامل کنید
              </div>
            )}
            <Button
              size="lg"
              variant="outline"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("pargar:chat", { detail: { open: true } }))
              }
            >
              <MessageSquare className="h-5 w-5" /> منتور
            </Button>
          </div>
        </div>
      </div>

      {data && <SkillTree data={data} onSelect={(id) => router.push(`/player/${id}`)} />}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-success" /> تکمیل‌شده
        </span>
        <span className="inline-flex items-center gap-1.5">
          <PlayCircle className="h-4 w-4 text-primary" /> در دسترس
        </span>
        <span className="inline-flex items-center gap-1.5">
          <BookOpenCheck className="h-4 w-4 text-gold" /> آمادهٔ آزمون
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-4 w-4 text-muted-foreground" /> قفل‌شده
        </span>
      </div>
    </div>
  );
}

function nextAction(
  inProgress: TreeLesson[],
  readyQuiz: TreeLesson[],
  openAndNew: TreeLesson[],
  firstLocked: TreeLesson | undefined,
  done: boolean,
) {
  if (readyQuiz[0]) {
    const lesson = readyQuiz[0];
    return {
      title: `آزمون «${lesson.title}» منتظر شماست`,
      desc: "آموخته‌هایتان را محک بزنید؛ هر پاسخ اشتباه یک جان کم می‌کند.",
      label: "شروع آزمون",
      cta: `/quiz/${lesson.id}`,
      icon: <BookOpenCheck className="h-5 w-5" />,
      locked: false,
      prereqId: null as number | null,
    };
  }
  if (inProgress[0]) {
    const lesson = inProgress[0];
    const pct = Math.round(lesson.progress?.watchedPct ?? 0);
    return {
      title: `ادامهٔ تماشای «${lesson.title}»`,
      desc: `${formatFaNumber(pct)}٪ تماشا شده — با رسیدن به آستانه، آزمون باز می‌شود.`,
      label: "ادامهٔ تماشا",
      cta: `/player/${lesson.id}`,
      icon: <PlayCircle className="h-5 w-5" />,
      locked: false,
      prereqId: null as number | null,
    };
  }
  if (openAndNew[0]) {
    const lesson = openAndNew[0];
    return {
      title: `شروع «${lesson.title}»`,
      desc: `${formatFaNumber(lesson.durationSeconds)} ثانیه تماشای تأییدشده · ${formatFaNumber(lesson.xpReward)} امتیاز پاداش در صورت تکمیل.`,
      label: "شروع درس",
      cta: `/player/${lesson.id}`,
      icon: <PlayCircle className="h-5 w-5" />,
      locked: false,
      prereqId: null as number | null,
    };
  }
  if (firstLocked) {
    return {
      title: `«${firstLocked.title}» قفل است`,
      desc: "بعد از تکمیل صادقانهٔ درس پیش‌نیاز و قبولی در آزمونش، این شاخه باز می‌شود.",
      label: "",
      cta: null as string | null,
      icon: null,
      locked: true,
      prereqId: firstLocked.requiresLessonId ?? null,
    };
  }
  if (done) {
    return {
      title: "همهٔ شاخه‌ها را آزاد کردید",
      desc: "تمام دروس تکمیل‌شده‌اند. گواهینامه را ببینید یا لیگ این هفته را فتح کنید.",
      label: "رفتن به لیگ‌ها",
      cta: "/leaderboard",
      icon: <ArrowLeft className="h-5 w-5" />,
      locked: false,
      prereqId: null as number | null,
    };
  }
  return {
    title: "مسیر آماده است",
    desc: "داده‌ای برای نمایش نیست.",
    label: "",
    cta: null as string | null,
    icon: null,
    locked: false,
    prereqId: null as number | null,
  };
}

function CapSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-5">
        <div className="space-y-4 rounded-2xl border-2 border-border bg-card p-5 shadow-offset-sm md:col-span-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-full rounded-full" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-5 md:col-span-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-7 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <Skeleton className="mt-6 h-11 w-40 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function ZapIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M13 2 4.5 13.5H11l-.8 8.5L18.5 10H12l1-8z" />
    </svg>
  );
}
