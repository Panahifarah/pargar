"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lock, TreePine } from "lucide-react";
import { VideoPlayer } from "@/components/video-player";
import { ApiError, http, toUserError } from "@/lib/api";
import type { Lesson, LessonProgress } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-store";
import { formatFaNumber } from "@/lib/utils";
import { hasInfiniteHearts } from "@/lib/hearts";

function isLessonLockedError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 403) return false;
  return error.message.includes("قفل");
}

export default function PlayerPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const id = Number(lessonId);
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["lesson", id],
    queryFn: () =>
      http.get<{
        lesson: Lesson;
        videoUrl: string;
        videoIsSample?: boolean;
        progress: LessonProgress | null;
        quizStatus: string;
      }>(`/api/lessons/${id}`),
    enabled: !!user && (!user.isLocked || hasInfiniteHearts(user.role)),
    staleTime: 5 * 60_000,
    retry: (count, err) => {
      if (isLessonLockedError(err)) return false;
      return count < 2;
    },
  });

  useEffect(() => {
    if (user?.isLocked && !hasInfiniteHearts(user.role)) router.replace("/lockout");
  }, [user?.isLocked, user?.role, router]);

  if (user?.isLocked && !hasInfiniteHearts(user.role)) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    if (isLessonLockedError(error)) {
      return <LockedLessonState onBack={() => router.push("/cap")} />;
    }
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <p className="font-medium text-destructive">{toUserError(error, "بارگذاری درس ممکن نشد")}</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => router.push("/cap")}>
            بازگشت به درخت
          </Button>
          <Button onClick={() => refetch()}>تلاش دوباره</Button>
        </div>
      </div>
    );
  }

  const { lesson, videoUrl, videoIsSample, progress, quizStatus } = data;
  const passed = !!progress?.passedQuiz;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => router.push("/cap")} aria-label="بازگشت به درخت مهارت">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{lesson.title}</h1>
            <p className="text-sm text-muted-foreground">{lesson.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {videoIsSample && (
            <Badge variant="outline" className="px-3 py-1 text-muted-foreground">
              نمونهٔ موقت
            </Badge>
          )}
          {passed ? (
            <Badge variant="success" className="px-3 py-1">تکمیل شده</Badge>
          ) : (
            <Badge variant="secondary" className="px-3 py-1">{formatFaNumber(lesson.xpReward)} امتیاز پاداش</Badge>
          )}
        </div>
      </div>

      {videoUrl ? (
        <div className="space-y-2">
          <VideoPlayer
            lessonId={id}
            videoUrl={videoUrl}
            duration={lesson.durationSeconds}
            completionThresholdPct={lesson.completionThresholdPct}
            initialProgress={progress}
          />
          {videoIsSample && (
            <p className="text-center text-xs text-muted-foreground">
              ویدیوی اختصاصی هنوز وصل نشده — <span className="font-bold">sample.mp4</span> به‌عنوان حداقل پخش
              نمایش داده می‌شود تا پلیر خالی نماند.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          این درس هنوز ویدیو ندارد.
        </div>
      )}

      <div className="flex items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Lock className="h-4 w-4" />
          آزمون با {`≥${lesson.completionThresholdPct}`}٪ زمان تماشای تاییدشده باز می‌شود.
          {quizStatus === "failed" && (
            <span className="text-destructive">تلاش قبلی ناموفق بود — هر وقت آماده بودید دوباره تلاش کنید.</span>
          )}
        </div>
        {passed && (
          <Button asChild variant="gradient">
            <Link href="/cap">ادامه مسیر</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function LockedLessonState({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-2 py-10 text-center sm:py-16">
      <div className="relative mb-6">
        <div
          aria-hidden
          className="absolute inset-0 -m-6 rounded-full bg-muted/80 blur-2xl"
        />
        <div className="relative grid h-20 w-20 place-items-center rounded-3xl border-2 border-border bg-card shadow-offset-sm">
          <Lock className="h-9 w-9 text-muted-foreground" strokeWidth={1.75} />
        </div>
      </div>

      <p className="text-[11px] font-extrabold tracking-wider text-muted-foreground">پیش‌نیاز باز نشده</p>
      <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">این درس هنوز قفل است</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        اول درس قبلی را کامل تماشا کنید و در آزمونش قبول شوید؛ بعد این شاخه خودش باز می‌شود.
      </p>

      <div className="mt-8 flex w-full max-w-xs flex-col gap-2.5">
        <Button size="lg" onClick={onBack} className="gap-2">
          <TreePine className="h-4 w-4" />
          بازگشت به درخت مهارت
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("pargar:chat", { detail: { open: true } }))
          }
        >
          پرسیدن از منتور
        </Button>
      </div>
    </div>
  );
}
