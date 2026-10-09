"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Flame, Heart, Sparkles, User as UserIcon } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import type { PublicProfile } from "@/lib/types";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, avatarPropsOf } from "@/components/ui/user-avatar";
import { formatFaNumber, formatStreakLabel } from "@/lib/utils";

const AdminProfileManage = dynamic(
  () => import("@/components/admin/profile-manage").then((m) => m.AdminProfileManage),
  { ssr: false },
);

function roleLabel(role: string) {
  if (role === "mentor") return "منتور";
  if (role === "admin") return "ادمین";
  return "هنرجو";
}

export default function PublicProfilePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const enabled = Number.isFinite(id) && id > 0;
  const isAdmin = useAuth((s) => s.user?.role === "admin");

  const profileQ = useQuery({
    queryKey: ["public-profile", id],
    queryFn: () => http.get<{ user: PublicProfile }>(`/api/users/${id}`),
    enabled,
    retry: 1,
  });

  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-sm text-muted-foreground">
        کاربر پیدا نشد.
      </div>
    );
  }

  if (profileQ.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" aria-busy="true" aria-label="در حال بارگذاری پروفایل">
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (profileQ.isError || !profileQ.data?.user) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-16 text-center">
        <p className="text-sm font-bold text-destructive">
          {toUserError(profileQ.error, "کاربر پیدا نشد")}
        </p>
        <Button asChild variant="outline">
          <Link href="/unwrap">بازگشت</Link>
        </Button>
      </div>
    );
  }

  const person = profileQ.data.user;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Panel
        title={person.name}
        description={roleLabel(person.role)}
        icon={<UserIcon className="h-5 w-5" />}
        tint="bg-primary/10 text-primary"
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <UserAvatar name={person.name} className="h-20 w-20" {...avatarPropsOf(person)} />
          <div className="min-w-0 flex-1 space-y-2 text-center sm:text-start">
            <h1 className="text-2xl font-black tracking-tight">{person.name}</h1>
            <p className="font-latin text-sm font-bold" dir="ltr">
              @{person.username}
            </p>
            {person.isLocked && (
              <p className="text-xs font-bold text-destructive">حساب قفل است</p>
            )}
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat icon={<Sparkles className="h-4 w-4 text-gold" />} label="امتیاز" value={formatFaNumber(person.xp)} />
        <Stat icon={<Heart className="h-4 w-4 text-destructive" />} label="قلب‌ها" value={formatFaNumber(person.hearts)} />
        <Stat
          icon={<Flame className="h-4 w-4 text-accent" />}
          label="زنجیرهٔ فعلی"
          value={formatStreakLabel(person.streakCurrent)}
        />
        <Stat
          icon={<Flame className="h-4 w-4 text-muted-foreground" />}
          label="بلندترین زنجیره"
          value={formatStreakLabel(person.streakLongest)}
        />
      </div>

      {isAdmin && <AdminProfileManage userId={person.id} />}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      {icon}
      <div>
        <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
        <p className="text-lg font-black tabular-nums">{value}</p>
      </div>
    </div>
  );
}
