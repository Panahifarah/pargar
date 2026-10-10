"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BannerEditor } from "@/components/banner-editor";
import { FreezeMark, isAccountMonochrome } from "@/components/freeze-mark";
import { toast } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { UserAvatar, avatarPropsOf, type AvatarVariantName } from "@/components/ui/user-avatar";
import { isVerifiedRole, VerifiedBadge } from "@/components/verified-badge";
import { apiForm, http, toUserError } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ProfileHeaderModel = {
  name: string;
  role?: string | null;
  banner?: string;
  createdAt?: string;
  avatarVariant?: AvatarVariantName;
  avatarPalette?: string;
  avatarPhoto?: string;
  isFrozen?: boolean;
  isClosed?: boolean;
};

export function membershipLine(createdAt?: string) {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return `عضویت از ${date.toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" })}`;
}

function useHoverBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (min-width: 640px)");
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return on;
}

/** Same header card on the owner profile, a public profile, and anyone opened from the league. */
export function ProfileHeader({
  person,
  secondary,
  editable = false,
  bannerBusy = false,
  onEditBanner,
  onRemoveBanner,
  onEditAvatar,
  children,
}: {
  person: ProfileHeaderModel;
  /** When set, replaces the membership line. Owner and public profiles leave this empty. */
  secondary?: string;
  editable?: boolean;
  bannerBusy?: boolean;
  onEditBanner?: () => void;
  onRemoveBanner?: () => void;
  onEditAvatar?: () => void;
  children?: ReactNode;
}) {
  const [bannerHot, setBannerHot] = useState(false);
  const hoverBanner = useHoverBanner();
  const hideBanner = () => setBannerHot(false);
  const banner = person.banner ?? "";
  const bannerLabel = banner ? "جایگزینی بنر" : "گذاشتن بنر";
  const line = secondary ?? membershipLine(person.createdAt);
  const canEditBanner = editable && !!onEditBanner;

  return (
    <header className={cn("relative overflow-hidden rounded-2xl border border-border bg-card", isAccountMonochrome(person) && "[filter:grayscale(1)]")}>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-accent/20 to-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card from-20% via-card/50 via-45% to-transparent" />
      </div>
      {canEditBanner && hoverBanner ? (
        <div
          className="absolute inset-x-0 top-0 z-10 h-44"
          onPointerEnter={() => setBannerHot(true)}
          onPointerLeave={hideBanner}
        >
          <div
            className={`absolute inset-0 bg-background/45 backdrop-blur-[2px] transition-opacity ${
              bannerHot ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-wrap items-center justify-center gap-2 px-3">
                <button
                  type="button"
                  className="rounded-lg bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-sm"
                  disabled={bannerBusy}
                  onClick={onEditBanner}
                >
                  {bannerLabel}
                </button>
                {banner && onRemoveBanner && (
                  <button
                    type="button"
                    className="rounded-lg bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-sm disabled:opacity-50"
                    disabled={bannerBusy}
                    onClick={onRemoveBanner}
                  >
                    برداشتن بنر
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : canEditBanner ? (
        <button
          type="button"
          className="absolute inset-0 z-10"
          aria-label={bannerLabel}
          onClick={onEditBanner}
        />
      ) : null}
      {editable && (
        <div className="absolute end-3 top-3 z-30">
          <Button type="button" variant="outline" size="sm" className="h-7 border-border/70 bg-card/80 px-2.5 text-[11px] shadow-none backdrop-blur" asChild>
            <Link href="/settings">تنظیمات</Link>
          </Button>
        </div>
      )}
      <div className="pointer-events-none relative z-20 h-44" />
      <div className="pointer-events-none relative z-20 -mt-12 flex items-end justify-start gap-4 px-5 pb-5">
        {editable && onEditAvatar ? (
          <button
            type="button"
            onClick={onEditAvatar}
            onPointerEnter={hideBanner}
            aria-label="ویرایش آواتار"
            className="group/avatar pointer-events-auto relative z-20 h-24 w-24 shrink-0 rounded-full"
          >
            <UserAvatar name={person.name} className="h-24 w-24 ring-4 ring-card" {...avatarPropsOf(person)} />
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-background/60 px-1 text-center text-[10px] font-bold leading-tight ring-4 ring-card transition-opacity ${
                hoverBanner
                  ? "opacity-0 group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
                  : "opacity-0"
              }`}
            >
              ویرایش آواتار
            </span>
          </button>
        ) : (
          <UserAvatar name={person.name} className="pointer-events-auto h-24 w-24 shrink-0 ring-4 ring-card" {...avatarPropsOf(person)} />
        )}
        <div
          className="pointer-events-auto flex w-fit max-w-full min-w-0 flex-col items-start gap-1"
          onPointerEnter={(event) => {
            event.stopPropagation();
            hideBanner();
          }}
        >
          <h1 className="flex max-w-full items-center gap-1 text-2xl font-black leading-tight tracking-tight">
            <span className="min-w-0 truncate">{person.name}</span>
            {isVerifiedRole(person.role) && <VerifiedBadge role={person.role} />}
            {isAccountMonochrome(person) && <FreezeMark closed={person.isClosed} />}
          </h1>
          {line ? <p className="w-fit max-w-full text-sm text-muted-foreground">{line}</p> : null}
        </div>
      </div>
      {children}
    </header>
  );
}

export function OwnerProfileHeader({ user, onEditAvatar }: { user: User; onEditAvatar: () => void }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const profileQ = useQuery({
    queryKey: ["me-profile"],
    queryFn: () => http.get<{ profile: { banner: string } }>("/api/me/profile"),
  });
  const banner = profileQ.data?.profile.banner ?? "";

  const upload = async (blob: Blob) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", new File([blob], "banner.png", { type: "image/png" }), "banner.png");
      const { url } = await apiForm<{ url: string }>("/api/me/avatar-photo", form);
      await http.put("/api/me/profile", { banner: url });
      await queryClient.invalidateQueries({ queryKey: ["me-profile"] });
      toast.success("بنر ذخیره شد");
      return true;
    } catch (e) {
      toast.error(toUserError(e, "ذخیره بنر ممکن نشد"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const removeBanner = async () => {
    setBusy(true);
    try {
      await http.put("/api/me/profile", { banner: "" });
      await queryClient.invalidateQueries({ queryKey: ["me-profile"] });
      setEditorOpen(false);
    } catch (e) {
      toast.error(toUserError(e, "برداشتن بنر ممکن نشد"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProfileHeader
      person={{
        name: user.name,
        role: user.role,
        banner,
        createdAt: user.createdAt,
        avatarVariant: user.avatarVariant,
        avatarPalette: user.avatarPalette,
        avatarPhoto: user.avatarPhoto,
        isFrozen: user.isFrozen,
        isClosed: user.isClosed,
      }}
      editable
      bannerBusy={busy}
      onEditBanner={() => setEditorOpen(true)}
      onRemoveBanner={banner ? () => void removeBanner() : undefined}
      onEditAvatar={onEditAvatar}
    >
      <BannerEditor
        open={editorOpen}
        busy={busy}
        onOpenChange={setEditorOpen}
        onRemove={banner ? () => void removeBanner() : undefined}
        onSave={async (blob) => {
          const ok = await upload(blob);
          if (ok) setEditorOpen(false);
        }}
      />
    </ProfileHeader>
  );
}
