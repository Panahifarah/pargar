"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Lock, Mail, Pencil, Phone, Shield, ShieldQuestion, Trash2, Unlock } from "lucide-react";
import { UserDialog } from "@/components/admin-studio";
import { useConfirm } from "@/components/admin/use-confirm";
import { Panel } from "@/components/panel";
import { toast } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { http, toUserError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { validatePassword } from "@/lib/validation";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";

export function AdminProfileManage({ userId }: { userId: number }) {
  const me = useAuth((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<"lock" | "delete" | "reset" | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const accountQ = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => http.get<{ user: User }>(`/api/admin/users/${userId}`),
    retry: 1,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
    qc.invalidateQueries({ queryKey: ["public-profile", userId] });
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "stats"] });
  };

  const account = accountQ.data?.user;
  const isSelf = account?.id === me?.id;
  const canDelete = !!account && !isSelf && (account.isFrozen || account.isClosed);

  const act = async (kind: "lock" | "unlock") => {
    setBusy("lock");
    try {
      await http.post(`/api/admin/users/${userId}/${kind}`);
      toast.success(kind === "lock" ? "حساب قفل شد" : "حساب فعال شد");
      refresh();
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(null);
    }
  };

  const closeReset = () => {
    setResetOpen(false);
    setNextPassword("");
    setConfirmPassword("");
  };

  const resetPassword = async () => {
    const pwErr = validatePassword(nextPassword, confirmPassword);
    if (pwErr) {
      toast.error(pwErr);
      return;
    }
    setBusy("reset");
    try {
      await http.post(`/api/admin/users/${userId}/reset-password`, { newPassword: nextPassword });
      toast.success("رمز عبور عوض شد");
      closeReset();
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    if (!account) {
      return;
    }
    if (
      !(await confirm(
        "حذف دائمی",
        `حساب «${account.name}» (${account.email}) برای همیشه حذف شود؟ این عمل بازگشت‌ناپذیر است.`,
      ))
    ) {
      return;
    }
    setBusy("delete");
    try {
      await http.del(`/api/admin/users/${account.id}`);
      toast.success("کاربر حذف شد");
      router.push("/admin?tab=users");
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title="مدیریت حساب"
        description="فقط ادمین این بخش را می‌بیند."
        icon={<Shield className="h-5 w-5" />}
        tint="bg-destructive/10 text-destructive"
      >
        {accountQ.isPending && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {accountQ.isError && (
          <p className="text-sm font-bold text-destructive">{toUserError(accountQ.error, "حساب پیدا نشد")}</p>
        )}
        {account && (
          <div className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <AccountFact icon={<Mail className="h-3.5 w-3.5" />} label="ایمیل" value={account.email} ltr />
              <AccountFact
                icon={<Phone className="h-3.5 w-3.5" />}
                label="تلفن"
                value={account.phone || "ثبت نشده"}
                ltr
              />
              <AccountFact
                className="sm:col-span-2"
                icon={<ShieldQuestion className="h-3.5 w-3.5" />}
                label="سوال امنیتی"
                value={account.securityQuestion || "تعریف نشده"}
              />
            </dl>
            <div className="space-y-2 border-t border-border/70 pt-4">
              {!isSelf &&
                (account.isLocked ? (
                  <Button size="sm" variant="success" disabled={busy !== null} onClick={() => act("unlock")}>
                    {busy === "lock" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                    فعال‌سازی
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("lock")}>
                    {busy === "lock" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                    قفل
                  </Button>
                ))}
              <div className={cn("grid gap-2", canDelete ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                <Button size="sm" variant="outline" className="w-full" onClick={() => setEditing(account)}>
                  <Pencil className="h-3.5 w-3.5" /> ویرایش
                </Button>
                <Button size="sm" variant="outline" className="w-full" disabled={busy !== null} onClick={() => setResetOpen(true)}>
                  <KeyRound className="h-3.5 w-3.5" /> ریست رمز
                </Button>
                {canDelete && (
                  <Button size="sm" variant="destructive" className="w-full" disabled={busy !== null} onClick={del}>
                    {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    حذف دائمی
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>
      <UserDialog user={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <Dialog open={resetOpen} onOpenChange={(open) => !open && closeReset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ریست رمز</DialogTitle>
            <DialogDescription>رمز جدید همین حساب را بنویسید.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">رمز جدید</Label>
              <PasswordInput
                id="reset-password"
                value={nextPassword}
                onChange={(e) => setNextPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="حداقل ۸ کاراکتر"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-password-confirm">تکرار رمز</Label>
              <PasswordInput
                id="reset-password-confirm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="همان رمز را دوباره بنویسید"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeReset}>
              انصراف
            </Button>
            <Button onClick={() => void resetPassword()} disabled={busy === "reset"}>
              {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              ذخیره رمز
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AccountFact({
  icon,
  label,
  value,
  ltr,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ltr?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border/80 bg-muted/25 px-3.5 py-3", className)}>
      <dt className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className={cn("mt-1.5 text-sm font-semibold leading-relaxed [overflow-wrap:anywhere]", ltr && "font-latin")} dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}
