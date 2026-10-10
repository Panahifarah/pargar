"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Flame, Heart, Sparkles, Trophy } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { http, toUserError } from "@/lib/api";
import type { LeaderboardData, MeetingEvent } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCertificateSlot } from "@/components/profile-certificate-slot";
import { OwnerProfileHeader } from "@/components/profile-header";
import { ChallengeCards } from "@/components/challenge-cards";
import { AvatarStudio } from "@/components/avatar-studio";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatFaNumber, formatJalaliStamp, formatStreakLabel } from "@/lib/utils";

export default function ProfilePage() {
  const user = useAuth((s) => s.user);
  const [studioOpen, setStudioOpen] = useState(false);
  const { data: lb, isError: lbError, error: lbErr } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => http.get<LeaderboardData>("/api/leaderboard/weekly"),
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-muted-foreground">برای مشاهدهٔ پروفایل وارد شوید.</p>
        <Button asChild className="mt-4">
          <Link href="/login">ورود</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <OwnerProfileHeader user={user} onEditAvatar={() => setStudioOpen(true)} />

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard icon={<Sparkles className="h-4 w-4 text-gold" />} label="امتیاز کل" value={formatFaNumber(user.xp)} />
        <StatCard icon={<Heart className="h-4 w-4 text-destructive" />} label="قلب‌ها" value={formatFaNumber(user.hearts)} />
        <StatCard
          icon={<Flame className="h-4 w-4 text-accent" />}
          label="زنجیرهٔ فعلی"
          value={formatStreakLabel(user.streakCurrent)}
        />
        <StatCard
          icon={<Flame className="h-4 w-4 text-muted-foreground" />}
          label="بلندترین زنجیره"
          value={formatStreakLabel(user.streakLongest)}
        />
      </div>

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Trophy className="h-5 w-5 text-gold" />
          <div className="flex-1">
            <p className="text-sm font-bold">رتبهٔ لیگ این هفته</p>
            {lbError ? (
              <p className="text-xs text-destructive">{toUserError(lbErr)}</p>
            ) : lb?.me && lb.me.rank > 0 ? (
              <p className="text-xs text-muted-foreground">
                رتبه {formatFaNumber(lb.me.rank)} با {formatFaNumber(Math.round(lb.me.xp))} امتیاز هفتگی
              </p>
            ) : lb ? (
              <p className="text-xs text-muted-foreground">هنوز در رتبه‌بندی این هفته نیستید</p>
            ) : (
              <Skeleton className="mt-1 h-3 w-40" />
            )}
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/leaderboard">لیگ‌ها</Link>
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-black text-muted-foreground">چالش‌های فعال</h2>
        <ChallengeCards />
      </div>

      <ProfileActivity />

      <div>
        <h2 className="mb-2 text-sm font-black text-muted-foreground">گواهینامه</h2>
        <ProfileCertificateSlot />
      </div>

      <Dialog open={studioOpen} onOpenChange={setStudioOpen}>
        <DialogContent className="flex max-h-[min(85vh,40rem)] max-w-lg flex-col gap-3 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-center">ویرایش آواتار</DialogTitle>
          </DialogHeader>
          <AvatarStudio user={user} onClose={() => setStudioOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileActivity() {
  const activityQ = useQuery({
    queryKey: ["me-activity"],
    queryFn: () => http.get<{ days: { day: string; count: number }[] }>("/api/me/activity"),
  });
  const eventsQ = useQuery({
    queryKey: ["events", "profile"],
    queryFn: () => http.get<{ events: MeetingEvent[] }>("/api/events"),
  });

  return (
    <div>
      <h2 className="mb-2 text-sm font-black text-muted-foreground">فعالیت</h2>
      <Card>
        <CardContent className="space-y-6 p-4">
          <div>
            <h3 className="text-sm font-black">تاریخچهٔ ماهانه</h3>
            <p className="mt-1 text-xs text-muted-foreground">هر بار یک ماه. پررنگ‌تر یعنی فعالیت بیشتر.</p>
            {activityQ.isPending ? (
              <Skeleton className="mt-3 h-24 rounded-xl" aria-busy="true" aria-label="در حال بارگذاری نمودار فعالیت" />
            ) : activityQ.isError ? (
              <p className="mt-3 text-sm font-bold text-destructive">{toUserError(activityQ.error, "بارگذاری فعالیت ممکن نشد")}</p>
            ) : (
              <ActivityGrid days={activityQ.data?.days ?? []} />
            )}
          </div>
          <div>
            <h3 className="text-sm font-black">رویدادها</h3>
            {eventsQ.isPending ? (
              <p className="mt-2 text-sm text-muted-foreground" aria-busy="true">
                در حال بارگذاری…
              </p>
            ) : eventsQ.isError ? (
              <p className="mt-2 text-sm font-bold text-destructive">{toUserError(eventsQ.error, "بارگذاری رویدادها ممکن نشد")}</p>
            ) : (eventsQ.data?.events ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">رویدادی نیست.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                {(eventsQ.data?.events ?? []).map((ev) => (
                  <li key={ev.id} className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="font-bold">{ev.title}</span>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={ev.startsAt}>
                      {formatJalaliStamp(ev.startsAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function activityCountLabel(count: number) {
  if (count <= 0) return "بدون فعالیت";
  return `${formatFaNumber(count)} فعالیت`;
}

const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

function ActivityGrid({ days }: { days: { day: string; count: number }[] }) {
  const [index, setIndex] = useState(0);
  const map = new Map(days.map((d) => [d.day.slice(0, 10), d.count]));
  const order: string[] = [];
  const months = new Map<string, { label: string; cells: { day: string; count: number }[] }>();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 119; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const id = jalaliMonthId(d);
    if (!months.has(id)) {
      order.push(id);
      months.set(id, { label: jalaliMonth(d), cells: [] });
    }
    months.get(id)!.cells.push({ day: key, count: map.get(key) ?? 0 });
  }
  const newestFirst = [...order].reverse();
  const safeIndex = Math.min(index, Math.max(newestFirst.length - 1, 0));
  const id = newestFirst[safeIndex];
  const month = id ? months.get(id) : undefined;
  if (!month || !id) return null;
  const pad = weekdayOffset(month.cells[0]?.day ?? "");

  return (
    <div className="mt-3" role="group" aria-label="تاریخچهٔ ماهانهٔ فعالیت، به تاریخ جلالی">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" disabled={safeIndex <= 0} onClick={() => setIndex(safeIndex - 1)}>
          ماه جدیدتر
        </Button>
        <h4 className="text-sm font-black">{month.label}</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={safeIndex >= newestFirst.length - 1}
          onClick={() => setIndex(safeIndex + 1)}
        >
          ماه قدیمی‌تر
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1" dir="ltr">
        {WEEKDAYS.map((name) => (
          <span key={name} className="text-center text-[10px] font-bold text-muted-foreground" dir="rtl">
            {name}
          </span>
        ))}
        {Array.from({ length: pad }, (_, i) => (
          <span key={`${id}-pad-${i}`} />
        ))}
        {month.cells.map((c) => {
          const date = jalaliDay(c.day);
          const countLabel = activityCountLabel(c.count);
          return (
            <button
              key={c.day}
              type="button"
              aria-label={`${date}، ${countLabel}`}
              className="group relative z-0 aspect-square min-h-0 w-full min-w-0 cursor-default appearance-none rounded-sm border-0 p-0 outline-none hover:z-30 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: c.count === 0 ? "var(--muted)" : `color-mix(in srgb, var(--primary) ${30 + Math.min(c.count, 6) * 12}%, white)` }}
            >
              <span
                role="tooltip"
                dir="rtl"
                className="pointer-events-none absolute bottom-[calc(100%+0.35rem)] left-1/2 z-30 hidden w-max -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-start text-sm leading-snug text-card-foreground shadow-soft group-hover:block group-focus-visible:block"
              >
                <span className="block font-bold whitespace-nowrap">{date}</span>
                <span className="block whitespace-nowrap text-muted-foreground">{countLabel}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function weekdayOffset(day: string) {
  if (!day) return 0;
  const d = new Date(day + "T12:00:00");
  return (d.getDay() + 1) % 7;
}

function jalaliMonthId(d: Date) {
  const parts = new Intl.DateTimeFormat("en-u-ca-persian", { year: "numeric", month: "2-digit" }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function jalaliMonth(d: Date) {
  const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "long", year: "numeric" }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${month} ${year}`;
}

function jalaliDay(day: string) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(day + "T12:00:00"),
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted">{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-black tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
