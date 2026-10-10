"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Flame, Heart, Sparkles } from "lucide-react";
import { ProfileHeader } from "@/components/profile-header";
import { NotFoundState, notFoundSentence } from "@/components/not-found-state";
import { http, toUserError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import type { PublicProfile } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFaNumber, formatStreakLabel } from "@/lib/utils";

const AdminProfileManage = dynamic(
  () => import("@/components/admin/profile-manage").then((m) => m.AdminProfileManage),
  { ssr: false },
);

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
      <NotFoundState
        title="کاربر پیدا نشد"
        description="این شناسه در سامانه نیست."
        href="/unwrap"
        actionLabel="بازگشت به مرکز"
      />
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
      <NotFoundState
        title="کاربر پیدا نشد"
        description={notFoundSentence(
          toUserError(profileQ.error, ""),
          "این شناسه در سامانه نیست.",
          "کاربر پیدا نشد",
        )}
        href="/unwrap"
        actionLabel="بازگشت به مرکز"
      />
    );
  }

  const person = profileQ.data.user;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ProfileHeader
        person={{
          name: person.name,
          role: person.role,
          banner: person.banner,
          createdAt: person.private ? undefined : person.createdAt,
          avatarVariant: person.avatarVariant,
          avatarPalette: person.avatarPalette,
          avatarPhoto: person.avatarPhoto,
          isFrozen: person.isFrozen,
          isClosed: person.isClosed,
        }}
        secondary={person.private ? "این پروفایل خصوصی است" : undefined}
      />
      {person.isLocked && <p className="text-xs font-bold text-destructive">حساب قفل است</p>}

      {person.private ? (
        <p className="text-sm text-muted-foreground">جز نام و آواتار چیزی نمایش داده نمی‌شود.</p>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2">
        {person.xp != null && <Stat icon={<Sparkles className="h-4 w-4 text-gold" />} label="امتیاز" value={formatFaNumber(person.xp)} />}
        {person.hearts != null && <Stat icon={<Heart className="h-4 w-4 text-destructive" />} label="قلب‌ها" value={formatFaNumber(person.hearts)} />}
        {person.streakCurrent != null && (
        <Stat
          icon={<Flame className="h-4 w-4 text-accent" />}
          label="زنجیرهٔ فعلی"
          value={formatStreakLabel(person.streakCurrent)}
        />
        )}
        {person.streakLongest != null && (
        <Stat
          icon={<Flame className="h-4 w-4 text-muted-foreground" />}
          label="بلندترین زنجیره"
          value={formatStreakLabel(person.streakLongest)}
        />
        )}
      </div>
      )}
      {(person.socialLinks ?? []).length > 0 && (
        <ul className="space-y-1 text-sm">
          {person.socialLinks!.map((l) => (
            <li key={l.url}>
              <a href={l.url} className="text-primary underline" target="_blank" rel="noreferrer">
                {l.name}
              </a>
            </li>
          ))}
        </ul>
      )}

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
