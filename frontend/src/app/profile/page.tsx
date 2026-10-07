"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Flame, Heart, Sparkles, Trophy, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { http, toUserError } from "@/lib/api";
import type { LeaderboardData } from "@/lib/types";
import { Panel } from "@/components/panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, avatarPropsOf } from "@/components/ui/user-avatar";
import { ProfileCertificateSlot } from "@/components/profile-certificate-slot";
import { ChallengeCards } from "@/components/challenge-cards";
import { AvatarStudio } from "@/components/avatar-studio";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatFaNumber, formatStreakLabel } from "@/lib/utils";
import { useState } from "react";

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
      <Panel
        title="پروفایل من"
        description="هویت، آمار یادگیری، چالش‌ها و گواهینامه در یک نگاه."
        icon={<UserIcon className="h-5 w-5" />}
        tint="bg-primary/10 text-primary"
        actions={
          <Button variant="outline" size="sm" onClick={() => setStudioOpen(true)}>
            ویرایش آواتار
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <UserAvatar name={user.name} className="h-20 w-20" {...avatarPropsOf(user)} />
          <div className="min-w-0 flex-1 space-y-2 text-center sm:text-start">
            <h1 className="text-2xl font-black tracking-tight">{user.name}</h1>
            <dl className="mt-1 space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-muted-foreground">نام کاربری</dt>
                <dd className="min-w-0 font-latin font-bold tracking-tight" dir="ltr">
                  @{user.username}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-muted-foreground">ایمیل</dt>
                <dd className="min-w-0 break-all font-latin font-medium" dir="ltr">
                  {user.email}
                </dd>
              </div>
              {user.phone && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-xs text-muted-foreground">تلفن</dt>
                  <dd className="min-w-0 font-latin font-medium" dir="ltr">
                    {user.phone}
                  </dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-muted-foreground">عضویت از</dt>
                <dd className="min-w-0 font-medium">
                  {new Date(user.createdAt).toLocaleDateString("fa-IR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </Panel>

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

      <div>
        <h2 className="mb-2 text-sm font-black text-muted-foreground">گواهینامه</h2>
        <ProfileCertificateSlot />
      </div>

      <Dialog open={studioOpen} onOpenChange={setStudioOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-center">ویرایش آواتار</DialogTitle>
          </DialogHeader>
          <AvatarStudio user={user} onClose={() => setStudioOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
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
