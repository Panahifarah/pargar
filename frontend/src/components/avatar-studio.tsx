"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { queryClient } from "@/lib/query-client";
import { apiForm, http, toUserError } from "@/lib/api";
import type { User } from "@/lib/types";
import { AVATAR_COLORS, AVATAR_VARIANTS, UserAvatar, avatarPaletteOf } from "@/components/ui/user-avatar";
import { AvatarCropDialog } from "@/components/avatar-crop";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PALETTES: { label: string; colors: string[] }[] = [
  { label: "پیش‌فرض", colors: AVATAR_COLORS },
  { label: "رزین", colors: ["#0f172a", "#38bdf8", "#f0abfc", "#a5f3fc", "#7c3aed", "#f5d0fe"] },
  { label: "صحرایی", colors: ["#1c1917", "#fbbf24", "#fb923c", "#fde68a", "#f97316", "#fed7aa"] },
  { label: "اسکاندی", colors: ["#022c22", "#34d399", "#fef3c7", "#a7f3d0", "#166534", "#d1fae5"] },
  { label: "نئون", colors: ["#18181b", "#a3e635", "#22d3ee", "#f97316", "#e879f9", "#fb7185"] },
  { label: "سلطنتی", colors: ["#20123a", "#9370db", "#e6e6fa", "#6b21a8", "#c084fc", "#f3e8ff"] },
];

export function AvatarStudio({ user, onClose }: { user: User; onClose: () => void }) {
  const setUser = useAuth((s) => s.setUser);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [draftV, setDraftV] = useState<string>(user.avatarVariant ?? "beam");
  const [draftP, setDraftP] = useState<string>(user.avatarPalette ?? "");
  const [confirming, setConfirming] = useState(false);

  const savedV = user.avatarVariant ?? "beam";
  const savedP = user.avatarPalette ?? "";
  const photo = user.avatarPhoto ?? "";
  const dirty = draftV !== savedV || draftP !== savedP;

  useEffect(() => {
    setDraftV(user.avatarVariant ?? "beam");
    setDraftP(user.avatarPalette ?? "");
  }, [user.avatarVariant, user.avatarPalette]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["mentors"] });
    void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
  };

  const doSave = async (body: { avatarVariant?: string; avatarPalette?: string; avatarPhoto?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const { user: fresh } = await http.put<{ user: User }>("/api/me/avatar", body);
      setUser(fresh);
      invalidate();
    } catch (e) {
      setError(toUserError(e, "خطا در ذخیره"));
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (photo && (draftV !== savedV || draftP !== savedP)) {
      setConfirming(true);
      return;
    }
    await doSave({ avatarVariant: draftV, avatarPalette: draftP });
  };

  const confirmReplace = async () => {
    setConfirming(false);
    await doSave({ avatarVariant: draftV, avatarPalette: draftP, avatarPhoto: "" });
  };

  const reset = () => {
    setDraftV(savedV);
    setDraftP(savedP);
    setError(null);
  };

  const onUpload = async (blob: Blob) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", new File([blob], "avatar.png", { type: "image/png" }), "avatar.png");
      const { url } = await apiForm<{ url: string }>("/api/me/avatar-photo", form);
      const { user: fresh } = await http.put<{ user: User }>("/api/me/avatar", { avatarPhoto: url });
      setUser(fresh);
      invalidate();
      setPending(null);
    } catch (e) {
      setError(toUserError(e, "خطا در آپلود"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <UserAvatar
            name={user.name ?? "؟"}
            src={photo}
            variant={draftV as User["avatarVariant"]}
            palette={avatarPaletteOf(draftP)}
            className="h-20 w-20"
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-popover",
              photo ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
            )}
          >
            {photo ? <span className="h-2 w-2 rounded-full bg-current" /> : <Camera className="h-3.5 w-3.5" />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold">{user.name}</p>
          <p className="text-[11px] text-muted-foreground">پیش‌نمایش زنده — تغییرات تا ذخیره اعمال نشده است</p>
          {dirty && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              تغییرات ذخیره‌نشده
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold text-muted-foreground">سبک</p>
        <div className="grid grid-cols-6 gap-1.5">
          {AVATAR_VARIANTS.map((v) => (
            <button
              key={v.name}
              title={v.label}
              onClick={() => setDraftV(v.name)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors",
                draftV === v.name ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-muted"
              )}
            >
              <UserAvatar name={user.name + v.name} variant={v.name} palette={avatarPaletteOf(draftP)} className="h-7 w-7" />
              <span className={cn("text-[9px]", draftV === v.name ? "text-primary" : "text-muted-foreground")}>
                {v.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold text-muted-foreground">رنگ‌ها</p>
        <div className="space-y-1">
          {PALETTES.map((p) => {
            const active = JSON.stringify(p.colors) === draftP;
            return (
              <button
                key={p.label}
                onClick={() => setDraftP(JSON.stringify(p.colors))}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 transition-colors",
                  active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                )}
              >
                <span className="text-xs font-bold">{p.label}</span>
                <span className="flex items-center gap-0.5">
                  {p.colors.slice(0, 5).map((c) => (
                    <span
                      key={c}
                      className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                      style={{ background: c }}
                    />
                  ))}
                  {active && <Check className="ms-1 h-3.5 w-3.5 text-primary" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="press flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          {photo ? "تغییر عکس" : "آپلود عکس"}
        </button>
        {photo && (
          <button
            onClick={() => doSave({ avatarPhoto: "" })}
            disabled={busy}
            className="press flex items-center justify-center gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs font-bold text-destructive disabled:opacity-50"
            title="حذف عکس و استفاده از آواتار گرافیکی"
          >
            <Trash2 className="h-3.5 w-3.5" />
            حذف عکس
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPending(f);
            e.target.value = "";
          }}
        />
      </div>

      {error && <p className="text-[11px] font-bold text-destructive">{error}</p>}

      <div className="sticky -bottom-3 z-10 -mx-2.5 flex items-center justify-between gap-2 bg-popover px-2.5 pb-1 pt-2">
        <div className="flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              <RotateCcw /> بازنشانی
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button onClick={onSave} disabled={busy} size="sm">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save />}
              ذخیره تغییرات
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onClose}>
              <Check /> اتمام
            </Button>
          )}
        </div>
      </div>

      <AvatarCropDialog
        file={pending}
        busy={busy}
        onCancel={() => !busy && setPending(null)}
        onCrop={(blob) => onUpload(blob)}
      />

      <Dialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
      >
        <DialogContent className="max-w-sm gap-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle>حذف عکس؟</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center gap-3">
            <UserAvatar name={user.name} src={photo} className="h-12 w-12" />
            <span className="text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
            </span>
            <UserAvatar
              name={user.name + "x"}
              variant={draftV as User["avatarVariant"]}
              palette={avatarPaletteOf(draftP)}
              className="h-12 w-12"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            برای اعمال این سبک، عکس فعلی آواتارت حذف می‌شود و آواتار گرافیکی جایگزین آن می‌شود. مطمئنی؟
          </p>
          <DialogFooter className="sm:space-x-0 sm:space-x-reverse sm:justify-start">
            <Button variant="destructive" onClick={confirmReplace} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 />}
              حذف عکس و اعمال سبک
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}