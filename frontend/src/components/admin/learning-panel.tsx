"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Flame,
  Heart,
  Loader2,
  Lock,
  Search,
  Sparkles,
  Trophy,
  Unlock,
  Users,
} from "lucide-react";
import { http, toUserError } from "@/lib/api";
import type {
  LearningOverview,
  StudentLearningRow,
  UserLearningDetail,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/providers";
import { cn, formatFaNumber } from "@/lib/utils";
import {
  DEFAULT_PAGE_SIZE,
  ListPagination,
  buildPageQuery,
  type Paginated,
} from "@/components/admin/list-pagination";

type SortKey = "xp" | "progress" | "activity" | "streak";
type FilterKey = "all" | "active" | "locked";

function pct(n: number) {
  return `${formatFaNumber(Math.round(n))}٪`;
}

function fmtDate(v?: string) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return v;
  }
}

export function LearningPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("xp");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, filter, sort]);

  const overviewQ = useQuery({
    queryKey: ["admin", "learning", "overview"],
    queryFn: () => http.get<{ overview: LearningOverview }>("/api/admin/learning/overview"),
    retry: 1,
  });

  const studentsQ = useQuery({
    queryKey: ["admin", "learning", "students", q, filter, sort, page],
    queryFn: () => {
      const params = new URLSearchParams(buildPageQuery(page));
      if (q.trim()) params.set("q", q.trim());
      if (filter !== "all") params.set("filter", filter);
      params.set("sort", sort);
      return http.get<Paginated<StudentLearningRow>>(
        `/api/admin/learning/students?${params.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const detailQ = useQuery({
    queryKey: ["admin", "learning", "user", selectedId],
    queryFn: () => http.get<{ learning: UserLearningDetail }>(`/api/admin/users/${selectedId}/learning`),
    enabled: selectedId != null,
    retry: 1,
  });

  const unlockStudent = async (id: number) => {
    setUnlocking(true);
    try {
      await http.post(`/api/admin/users/${id}/unlock`);
      toast.success("قفل حساب باز شد و جان‌ها بازگردانی شدند");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "learning"] }),
        qc.invalidateQueries({ queryKey: ["admin", "learning", "user", id] }),
      ]);
    } catch (e) {
      toast.error(toUserError(e, "باز کردن قفل ممکن نشد"));
    } finally {
      setUnlocking(false);
    }
  };

  const overview = overviewQ.data?.overview;
  const students = studentsQ.data?.items ?? [];
  const studentsTotal = studentsQ.data?.total ?? 0;
  const studentsPageSize = studentsQ.data?.pageSize ?? DEFAULT_PAGE_SIZE;

  const cards = overview
    ? [
        { label: "هنرجویان فعال", value: overview.studentsActive, hint: `از ${formatFaNumber(overview.studentsTotal)} نفر`, icon: Users },
        { label: "قفل‌شده", value: overview.studentsLocked, hint: "نیاز به باز کردن قفل", icon: Lock },
        { label: "تکمیل درس", value: overview.completions, hint: `${formatFaNumber(overview.lessonsTotal)} درس فعال`, icon: Trophy },
        { label: "نرخ قبولی ۷روزه", value: Math.round(overview.passRate7d), hint: `${formatFaNumber(overview.passes7d)}/${formatFaNumber(overview.attempts7d)} تلاش`, icon: Sparkles, suffix: "٪" },
        { label: "میانگین تماشا", value: Math.round(overview.avgWatchPct), hint: "درس‌های ناتمام", icon: Flame, suffix: "٪" },
        { label: "امتیاز ۷روزه", value: overview.xpAwarded7d, hint: `${formatFaNumber(overview.studentsStreaking)} با استریک`, icon: Sparkles },
      ]
    : [];

  return (
    <div className="space-y-4">
      {(overviewQ.isError || studentsQ.isError) && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 font-bold text-destructive">
            {toUserError(overviewQ.error ?? studentsQ.error, "بارگذاری داشبورد یادگیری ممکن نشد")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void overviewQ.refetch();
              void studentsQ.refetch();
            }}
          >
            تلاش دوباره
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {overviewQ.isLoading &&
          [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <c.icon className="h-5 w-5" />
              </div>
              <p className="text-3xl font-black tabular-nums">
                {formatFaNumber(c.value)}
                {c.suffix ?? ""}
              </p>
              <p className="text-sm font-bold">{c.label}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">جدول هنرجویان</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatFaNumber(studentsTotal)} نفر · برای جزئیات روی ردیف بزنید
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جستجوی نام یا ایمیل…"
                className="h-10 ps-9"
              />
            </div>
            <select
              className="h-10 rounded-lg border border-input bg-card px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
            >
              <option value="all">همه</option>
              <option value="active">فعال</option>
              <option value="locked">قفل‌شده</option>
            </select>
            <select
              className="h-10 rounded-lg border border-input bg-card px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="xp">مرتب‌سازی: امتیاز</option>
              <option value="progress">مرتب‌سازی: پیشرفت</option>
              <option value="activity">مرتب‌سازی: آخرین فعالیت</option>
              <option value="streak">مرتب‌سازی: استریک</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {studentsQ.isLoading && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-2 py-2 text-right font-bold">هنرجو</th>
                  <th className="px-2 py-2 text-right font-bold">پیشرفت</th>
                  <th className="px-2 py-2 text-right font-bold">امتیاز</th>
                  <th className="px-2 py-2 text-right font-bold">جان</th>
                  <th className="px-2 py-2 text-right font-bold">استریک</th>
                  <th className="px-2 py-2 text-right font-bold">۷روزه</th>
                  <th className="px-2 py-2 text-right font-bold">آخرین فعالیت</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40"
                    onClick={() => setSelectedId(s.id)}
                  >
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-extrabold">
                            {s.name}
                            {s.isLocked && (
                              <Badge variant="destructive" className="ms-2 px-1.5 text-[10px]">
                                قفل
                              </Badge>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
                            @{s.username}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="w-28">
                        <div className="mb-1 flex justify-between text-[10px] font-bold">
                          <span>
                            {formatFaNumber(s.lessonsPassed)}/{formatFaNumber(s.lessonsTotal)}
                          </span>
                          <span>{pct(s.progressPct)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, s.progressPct)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 font-bold tabular-nums">{formatFaNumber(s.xp)}</td>
                    <td className="px-2 py-3">
                      <span className="inline-flex items-center gap-1 font-bold">
                        <Heart className={cn("h-3.5 w-3.5", s.hearts <= 1 && "fill-current text-destructive")} />
                        {formatFaNumber(s.hearts)}
                      </span>
                    </td>
                    <td className="px-2 py-3 font-bold tabular-nums">{formatFaNumber(s.streakCurrent)}</td>
                    <td className="px-2 py-3 text-xs text-muted-foreground">
                      {formatFaNumber(s.passes7d)}/{formatFaNumber(s.attempts7d)}
                      {s.attempts7d > 0 && (
                        <span className="ms-1 font-bold text-foreground">({pct(s.passRate7d)})</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-xs text-muted-foreground">{fmtDate(s.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {students.length === 0 && !studentsQ.isLoading && (
              <p className="py-10 text-center text-sm text-muted-foreground">هنرجویی یافت نشد.</p>
            )}
          </div>
          <ListPagination
            page={page}
            pageSize={studentsPageSize}
            total={studentsTotal}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <Dialog open={selectedId != null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0 sm:rounded-2xl">
          <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-start">
            <DialogTitle className="text-lg font-black">
              {detailQ.data?.learning.user.name ?? "جزئیات یادگیری"}
            </DialogTitle>
            <DialogDescription>
              {detailQ.isError
                ? toUserError(detailQ.error, "بارگذاری جزئیات ممکن نشد")
                : detailQ.data
                  ? `@${detailQ.data.learning.user.username} · ${pct(detailQ.data.learning.user.progressPct)} مسیر`
                  : "در حال بارگذاری…"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            {detailQ.isLoading && (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> بارگذاری جزئیات
              </div>
            )}
            {detailQ.isError && (
              <p className="text-sm font-bold text-destructive">{toUserError(detailQ.error)}</p>
            )}
            {detailQ.data && (
              <>
                {detailQ.data.learning.user.isLocked && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-destructive/30 bg-destructive/5 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <div>
                        <p className="text-sm font-extrabold text-destructive">حساب قفل است</p>
                        <p className="text-xs text-muted-foreground">
                          پس از باز کردن قفل، سه جان بازمی‌گردد و مسیر ادامه پیدا می‌کند.
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="success"
                      disabled={unlocking}
                      onClick={() => unlockStudent(detailQ.data!.learning.user.id)}
                      className="gap-1.5"
                    >
                      {unlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                      باز کردن قفل
                    </Button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { l: "امتیاز", v: formatFaNumber(detailQ.data.learning.user.xp) },
                    { l: "جان", v: formatFaNumber(detailQ.data.learning.user.hearts) },
                    { l: "استریک", v: formatFaNumber(detailQ.data.learning.user.streakCurrent) },
                    {
                      l: "تکمیل",
                      v: `${formatFaNumber(detailQ.data.learning.user.lessonsPassed)}/${formatFaNumber(detailQ.data.learning.user.lessonsTotal)}`,
                    },
                  ].map((x) => (
                    <div key={x.l} className="rounded-2xl border border-border px-3 py-2 text-center">
                      <p className="text-[10px] font-bold text-muted-foreground">{x.l}</p>
                      <p className="text-lg font-black tabular-nums">{x.v}</p>
                    </div>
                  ))}
                </div>

                <section className="space-y-2">
                  <h3 className="text-sm font-black">دروس</h3>
                  <div className="max-h-64 space-y-1.5 overflow-y-auto">
                    {detailQ.data.learning.lessons.map((l) => (
                      <div
                        key={l.lessonId}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            L{l.lessonId} · {l.title}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{l.chapterTitle}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
                            {pct(l.watchedPct)}
                          </span>
                          {l.passedQuiz ? (
                            <Badge variant="success" className="text-[10px]">
                              قبول
                            </Badge>
                          ) : l.quizUnlocked ? (
                            <Badge variant="secondary" className="text-[10px]">
                              آزمون باز
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              در حال تماشا
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-black">تلاش‌های آزمون</h3>
                  {detailQ.data.learning.attempts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">هنوز تلاشی ثبت نشده.</p>
                  ) : (
                    <div className="max-h-48 space-y-1.5 overflow-y-auto">
                      {detailQ.data.learning.attempts.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-xs"
                        >
                          <span className="min-w-0 truncate font-bold">{a.lessonTitle}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatFaNumber(a.correctCount)}/{formatFaNumber(a.total)} · {pct(a.scorePct)}
                          </span>
                          <Badge
                            variant={a.status === "passed" ? "success" : "destructive"}
                            className="shrink-0 text-[10px]"
                          >
                            {a.status === "passed" ? "قبول" : "رد"}
                          </Badge>
                          <span className="shrink-0 text-muted-foreground">{fmtDate(a.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-sm font-black">امتیازها</h3>
                    <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
                      {detailQ.data.learning.xpEvents.map((x) => (
                        <div key={x.id} className="flex justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
                          <span className="font-bold text-gold">+{formatFaNumber(x.amount)}</span>
                          <span className="text-muted-foreground">{x.source}</span>
                          <span className="text-muted-foreground">{fmtDate(x.createdAt)}</span>
                        </div>
                      ))}
                      {detailQ.data.learning.xpEvents.length === 0 && (
                        <p className="text-muted-foreground">رویداد امتیازی نیست.</p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-black">نشست‌های تماشا</h3>
                    <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
                      {detailQ.data.learning.sessions.map((s) => (
                        <div key={`${s.lessonId}-${s.startedAt}`} className="rounded-lg bg-muted/40 px-2 py-1.5">
                          <p className="truncate font-bold">{s.lessonTitle}</p>
                          <p className="text-muted-foreground">آخرین ضربان: {fmtDate(s.lastHeartbeatAt)}</p>
                        </div>
                      ))}
                      {detailQ.data.learning.sessions.length === 0 && (
                        <p className="text-muted-foreground">نشست تماشایی نیست.</p>
                      )}
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
