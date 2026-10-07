"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, Sparkles, Timer, Trophy } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import type { LeaderboardData, LeaderboardEntry } from "@/lib/types";
import { cn, formatFaNumber } from "@/lib/utils";
import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar, avatarPropsOf } from "@/components/ui/user-avatar";
import { ChallengeCards } from "@/components/challenge-cards";
import { Button } from "@/components/ui/button";

const medalClasses = {
  1: "bg-gold text-gold-foreground shadow-offset-sm",
  2: "bg-secondary text-secondary-foreground shadow-offset-sm",
  3: "bg-accent text-accent-foreground shadow-offset-sm",
};

export function LeaderboardPanel() {
  const user = useAuth((s) => s.user);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => http.get<LeaderboardData>("/api/leaderboard/weekly"),
  });
  const { resetLabel, nextResetJalali } = useResetCountdown();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-medium text-destructive">{toUserError(error)}</p>
        <Button className="mt-3" variant="outline" onClick={() => refetch()}>
          تلاش دوباره
        </Button>
      </div>
    );
  }

  const entries = data?.entries ?? [];
  const me = data?.me;

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ChallengeCards />
      <Panel
        title={
          <>
            لیگ هفتگی · <span className="text-muted-foreground">{data?.week}</span>
          </>
        }
        description="لیگ هفتگی جدا از چالش ماهانه است. رتبه‌بندی هر دوشنبهٔ میلادی (آغاز هفتهٔ ISO) صفر می‌شود."
        icon={<Trophy className="h-5 w-5" />}
        tint="bg-gold/10 text-gold"
      >
        <div className="space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-muted/80 px-3 py-1.5 text-xs font-bold text-muted-foreground">
              <Timer className="h-3.5 w-3.5 shrink-0" />
              ریست دوشنبه · {resetLabel}
            </span>
            <span className="inline-flex w-fit items-center rounded-lg bg-muted/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              معادل جلالی: {nextResetJalali}
            </span>
            {me && me.rank > 0 && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
                <Crown className="h-3.5 w-3.5 shrink-0" />
                رتبه {fa(me.rank)} شمایید
              </span>
            )}
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-l from-gold/10 via-card to-primary/5 px-5 py-6 sm:px-8">
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-gold/15 text-gold">
                <Sparkles className="h-5 w-5" />
              </span>
              <p className="text-3xl font-black tabular-nums tracking-tight">
                {formatFaNumber(Math.round(me?.xp ?? 0))}
              </p>
              <p className="text-sm font-bold text-muted-foreground">
                {me && me.rank > 0 ? "امتیاز شما این هفته" : "هنوز امتیازی کسب نکرده‌اید — بروید به دست آورید"}
              </p>
            </div>
          </div>

          {podium.length > 0 && <Podium entries={podium} myId={user?.id} />}

          <div className="space-y-1.5">
            {rest.map((e) => {
              const isMe = !!user && e.userId === user.id;
              return (
                <div
                  key={e.userId}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-2.5",
                    isMe ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "border-border bg-card"
                  )}
                >
                  <span
                    className={cn(
                      "w-8 shrink-0 text-center text-sm font-bold",
                      isMe ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {formatFaNumber(e.rank)}
                  </span>
                  <UserAvatar name={e.name} className="h-8 w-8" {...avatarPropsOf(e)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.name}</span>
                  {isMe && (
                    <span className="hidden shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold text-primary sm:inline">
                      شما
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-bold text-gold">
                    {formatFaNumber(Math.round(e.xp))} امتیاز
                  </span>
                </div>
              );
            })}
            {rest.length === 0 && entries.length === 0 && (
              <EmptyState
                icon={<Trophy className="h-6 w-6" />}
                title="هنوز رتبه‌بندی وجود ندارد"
                description="با تکمیل صادقانه درس‌ها امتیاز کسب کنید تا در لیگ بالا بروید."
              />
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Podium({ entries, myId }: { entries: LeaderboardEntry[]; myId?: number }) {
  if (entries.length === 1) {
    return (
      <div className="flex justify-center">
        <PodiumCard entry={entries[0]!} tall myId={myId} className="w-full max-w-[11rem]" />
      </div>
    );
  }

  if (entries.length === 2) {
    const ordered = [...entries].sort((a, b) => a.rank - b.rank);
    return (
      <div className="mx-auto grid max-w-md grid-cols-2 items-end gap-3">
        {ordered.map((e) => (
          <PodiumCard key={e.userId} entry={e} tall={e.rank === 1} myId={myId} />
        ))}
      </div>
    );
  }

  // Classic 2nd · 1st · 3rd visual order
  return (
    <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
      {[1, 0, 2].map((idx) => {
        const e = entries[idx];
        if (!e) return <div key={idx} />;
        return <PodiumCard key={e.userId} entry={e} tall={e.rank === 1} myId={myId} />;
      })}
    </div>
  );
}

function PodiumCard({
  entry,
  tall,
  myId,
  className,
}: {
  entry: LeaderboardEntry;
  tall?: boolean;
  myId?: number;
  className?: string;
}) {
  const isMe = myId != null && entry.userId === myId;
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border-2 border-border bg-card px-3 py-4 text-center shadow-offset-sm",
        tall ? "pb-6 pt-5" : "pb-4",
        isMe && "border-primary/50 ring-2 ring-primary/30",
        className
      )}
    >
      <UserAvatar
        name={entry.name}
        className={cn(
          "mb-2 h-12 w-12",
          tall && "h-14 w-14 ring-2 ring-gold ring-offset-2 ring-offset-background"
        )}
        {...avatarPropsOf(entry)}
      />
      <p className="w-full truncate text-sm font-extrabold">{entry.name}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
        {formatFaNumber(Math.round(entry.xp))} امتیاز
      </p>
      <div
        className={cn(
          "mt-2 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black",
          medalClasses[entry.rank as 1 | 2 | 3] ?? "bg-muted text-muted-foreground"
        )}
      >
        {entry.rank === 1 ? <Crown className="h-4 w-4" /> : formatFaNumber(entry.rank)}
      </div>
    </div>
  );
}

function fa(n: number) {
  return n.toLocaleString("fa-IR");
}

function useResetCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return useMemo(() => {
    const d = new Date(now);
    const day = d.getDay();
    const add = ((1 - day + 7) % 7) || 7;
    const target = new Date(d);
    target.setDate(d.getDate() + add);
    target.setHours(0, 0, 0, 0);
    const diff = Math.max(target.getTime() - now, 0);
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    let resetLabel = `${fa(minutes)} دقیقه`;
    if (days > 0) resetLabel = `${fa(days)} روز ${fa(hours)} ساعت`;
    else if (hours > 0) resetLabel = `${fa(hours)} ساعت ${fa(minutes)} دقیقه`;
    const nextResetJalali = target.toLocaleDateString("fa-IR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return { resetLabel, nextResetJalali };
  }, [now]);
}
