"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  Flame,
  Loader2,
  Lock,
  PartyPopper,
  Sparkles,
  Zap,
} from "lucide-react";
import { NotFoundState, notFoundSentence } from "@/components/not-found-state";
import { ApiError, api, http, toUserError } from "@/lib/api";
import type { QuizData, QuizResult } from "@/lib/types";
import { HeartsMeter } from "@/components/hearts-meter";
import { useLiveUser } from "@/hooks/use-live-user";
import { hasInfiniteHearts } from "@/lib/hearts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn, formatFaNumber, formatOptionLetter, formatStreakLabel } from "@/lib/utils";

export function QuizExperience({ lessonId }: { lessonId: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const liveUser = useLiveUser();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idOk = Number.isFinite(lessonId) && lessonId > 0;
  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["quiz", lessonId],
    queryFn: () => http.get<QuizData>(`/api/lessons/${lessonId}/quiz`),
    enabled: idOk,
    retry: false,
    meta: { silentError: true },
  });

  const questions = data?.questions ?? [];
  const answeredCount = Object.keys(answers).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  const select = (qid: number, idx: number) =>
    setAnswers((prev) => ({ ...prev, [qid]: idx }));

  const submit = async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const ordered = questions.map((q) => answers[q.id] ?? -1);
      const res = await api<QuizResult>(`/api/lessons/${lessonId}/quiz/submit`, {
        method: "POST",
        body: { answers: ordered },
      });
      setResult(res);
      qc.invalidateQueries({ queryKey: ["tree"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      if (res.locked && !hasInfiniteHearts(liveUser?.role)) router.push("/lockout");
    } catch (e) {
      setError((e as Error)?.message ?? "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  };

  if (!idOk || (loadError instanceof ApiError && loadError.status === 404)) {
    return (
      <NotFoundState
        title="آزمون پیدا نشد"
        description={notFoundSentence(
          loadError ? toUserError(loadError, "") : "",
          "این آزمون در سامانه نیست.",
          "آزمون پیدا نشد",
        )}
        href="/cap"
        actionLabel="بازگشت به درخت مهارت"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="w-full max-w-xl space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="rounded-2xl border-2 border-border bg-card p-6 shadow-soft">
            <Skeleton className="h-5 w-2/3" />
            <div className="mt-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
            <Skeleton className="mt-6 h-11 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || (loadError && !data)) {
    const msg = toUserError(
      loadError,
      error ?? "بارگذاری آزمون ممکن نشد. ابتدا درس را تا آستانه تماشا کنید.",
    );
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <Lock className="mx-auto mb-3 h-10 w-10 text-destructive" />
        <h2 className="mb-2 text-lg font-semibold">آزمون در دسترس نیست</h2>
        <p className="mb-4 text-sm text-muted-foreground">{msg}</p>
        <Button onClick={() => router.push(`/player/${lessonId}`)}>ابتدا درس را تماشا کنید</Button>
      </Card>
    );
  }

  if (data?.passed) {
    return (
      <Card className="mx-auto max-w-md p-10 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-success" />
        <h2 className="text-2xl font-bold text-primary">درس تکمیل شده</h2>
        <p className="mt-1 text-sm text-muted-foreground">شما قبلاً این آزمون را با موفقیت گذرانده‌اید.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => router.push("/cap")}>
            <ArrowLeft className="h-4 w-4" /> درخت مهارت
          </Button>
          <Button variant="gradient" onClick={() => router.push("/leaderboard")}>
            لیگ‌ها
          </Button>
        </div>
      </Card>
    );
  }

  const infiniteHearts = hasInfiniteHearts(liveUser?.role);

  if (result) {
    return (
      <ResultScreen
        result={result}
        lessonId={lessonId}
        infiniteHearts={infiniteHearts}
        onRetake={() => {
          setResult(null);
          setAnswers({});
          qc.invalidateQueries({ queryKey: ["quiz", lessonId] });
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">آزمون دروس</p>
          <h1 className="text-2xl font-bold">آموخته‌هایتان را ثابت کنید</h1>
        </div>
        <HeartsMeter hearts={liveUser?.hearts ?? 3} size="md" infinite={infiniteHearts} />
      </div>
      {!infiniteHearts && (
        <p className="-mt-3 text-sm text-muted-foreground">
          هر پاسخ اشتباه یک قلب کم می‌کند. با از دست دادن هر سه قلب، حساب محدود می‌شود و ادامهٔ مسیر
          فقط پس از بررسی مدیریت ممکن است.
        </p>
      )}
      {infiniteHearts && (
        <p className="-mt-3 text-sm text-muted-foreground">جان شما نامحدود است — می‌توانید بدون محدودیت آزمون را تکرار کنید.</p>
      )}

      <div className="space-y-4">
        {questions.map((q, qi) => (
          <Card key={q.id} className="overflow-hidden">
            <CardContent className="pt-5">
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className="h-6 w-6 justify-center rounded-md p-0">
                  {qi + 1}
                </Badge>
                <p className="font-medium leading-snug">{q.question}</p>
              </div>
              <div className="grid gap-2">
                {q.options.map((opt, oi) => {
                  const active = answers[q.id] === oi;
                  return (
                    <button
                      key={oi}
                      onClick={() => select(q.id, oi)}
                      className={cn(
                        "flex items-center gap-3 rounded-md border px-4 py-3 text-right text-sm transition-colors",
                        active
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-semibold",
                          active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                        )}
                      >
                        {formatOptionLetter(oi)}
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 pt-2">
        <p className="text-sm text-muted-foreground">
          {answeredCount}/{questions.length} پاسخ‌داده‌شده
        </p>
        <Button
          size="lg"
          variant="gradient"
          disabled={!allAnswered || submitting}
          onClick={submit}
          className="min-w-44"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          ثبت و بررسی
        </Button>
      </div>
    </div>
  );
}

function ResultScreen({
  result,
  lessonId,
  onRetake,
  infiniteHearts,
}: {
  result: QuizResult;
  lessonId: number;
  onRetake: () => void;
  infiniteHearts: boolean;
}) {
  const router = useRouter();
  const pct = result.total ? Math.round((result.correctCount / result.total) * 100) : 0;

  if (result.passed) return <PassScreen result={result} onNext={() => router.push("/cap")} onLeagues={() => router.push("/leaderboard")} />;

  const showLock = result.locked && !infiniteHearts;

  return (
    <div className="mx-auto max-w-md space-y-5 pt-4">
      <Card className="overflow-hidden p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-destructive/10">
          <AlertTriangle className="h-9 w-9 text-destructive" />
        </div>
        <h2 className="text-2xl font-bold">هنوز کافی نیست</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatFaNumber(result.correctCount)}/{formatFaNumber(result.total)} پاسخ درست. درس را مرور کنید و دوباره تلاش کنید
          {!infiniteHearts && " — هر پاسخ اشتباه یک قلب کم می‌کند"}.
        </p>
        <div className="my-5">
          <Progress value={pct} className="h-3" />
          <p className="mt-1 text-xs text-muted-foreground">{pct}٪ درست</p>
        </div>
        <div className="flex justify-center">
          {showLock ? (
            <Button variant="destructive" onClick={() => router.push("/lockout")}>
              <Lock className="h-4 w-4" /> حساب قفل شد
            </Button>
          ) : (
            <Button variant="outline" onClick={onRetake}>
              <ChevronLeft className="h-4 w-4 rotate-180" /> تلاش مجدد
            </Button>
          )}
        </div>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        قلب‌های باقی‌مانده: <HeartsMeterInline hearts={result.heartsLeft} infinite={infiniteHearts} />
      </p>
    </div>
  );
}

function HeartsMeterInline({ hearts, infinite }: { hearts: number; infinite?: boolean }) {
  return <HeartsMeter hearts={hearts} size="sm" infinite={infinite} />;
}

function PassScreen({ result, onNext, onLeagues }: { result: QuizResult; onNext: () => void; onLeagues: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-10 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-primary">
        <PartyPopper className="h-9 w-9 text-primary-foreground" />
      </div>
      <h2 className="text-2xl font-bold text-primary">آزمون قبول شد!</h2>
      <p className="mt-1 text-sm text-muted-foreground">پیشرفت جدی. درس‌های بعدی آزاد شدند.</p>
      <div className="mt-5 flex items-center justify-center gap-3">
        <Badge variant="gold" className="gap-1 px-3 py-1.5 text-sm">
          <Sparkles className="h-4 w-4" /> {formatFaNumber(result.xpEarned)} امتیاز
        </Badge>
        <Badge variant="accent" className="gap-1 px-3 py-1.5 text-sm">
          <Flame className="h-4 w-4" /> {formatStreakLabel(result.streak)}
        </Badge>
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="outline" onClick={onLeagues}>لیگ‌ها</Button>
        <Button variant="gradient" size="lg" onClick={onNext}>
          ادامه مسیر <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}