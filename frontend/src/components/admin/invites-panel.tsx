"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, Ban, Pause, Play, Pencil } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import type { RegistrationInvite } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/providers";
import { formatFaNumber } from "@/lib/utils";
import {
  DEFAULT_PAGE_SIZE,
  ListPagination,
  buildPageQuery,
  type Paginated,
} from "@/components/admin/list-pagination";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { validateInviteLabel } from "@/lib/validation";

const STATUS_LABEL: Record<RegistrationInvite["status"], string> = {
  active: "فعال",
  paused: "متوقف موقت",
  revoked: "لغو شده",
  exhausted: "تکمیل شده",
};

function inviteDisplayURL(inv: RegistrationInvite): string {
  if (inv.url) return inv.url;
  if (inv.token && typeof window !== "undefined") {
    return `${window.location.origin}/register/invite/${inv.token}`;
  }
  return "";
}

function statusBadgeVariant(
  status: RegistrationInvite["status"],
): "secondary" | "destructive" | "outline" {
  if (status === "active") return "secondary";
  if (status === "revoked") return "destructive";
  return "outline";
}

export function InvitesPanel() {
  const qc = useQueryClient();
  const [maxUses, setMaxUses] = useState(10);
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<RegistrationInvite | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editMaxUses, setEditMaxUses] = useState(1);
  const [editExpiresInDays, setEditExpiresInDays] = useState("");
  const [editClearExpires, setEditClearExpires] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  useEffect(() => {
    setPage(1);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "invites", q, page],
    queryFn: () => {
      const params = new URLSearchParams(buildPageQuery(page));
      if (q.trim()) params.set("q", q.trim());
      return http.get<Paginated<RegistrationInvite>>(`/api/admin/invites?${params.toString()}`);
    },
  });

  const invites = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? DEFAULT_PAGE_SIZE;

  const create = async () => {
    if (maxUses < 1 || maxUses > 10_000) {
      toast.error("ظرفیت باید بین ۱ تا ۱۰۰۰۰ باشد");
      return;
    }
    const labelErr = validateInviteLabel(label);
    if (labelErr) {
      toast.error(labelErr);
      return;
    }
    setBusy(true);
    try {
      const body: { maxUses: number; label?: string; expiresInDays?: number } = {
        maxUses,
      };
      if (label.trim()) body.label = label.trim();
      const days = Number(expiresInDays);
      if (expiresInDays.trim() && Number.isFinite(days) && days > 0) {
        body.expiresInDays = Math.floor(days);
      }
      const res = await http.post<{ invite: RegistrationInvite }>("/api/admin/invites", body);
      const url = inviteDisplayURL(res.invite);
      if (url) {
        try {
          await navigator.clipboard.writeText(url);
          toast.success("لینک ساخته و کپی شد");
        } catch {
          toast.success("لینک عضویت ساخته شد");
        }
      } else {
        toast.success("لینک عضویت ساخته شد");
      }
      setLabel("");
      setExpiresInDays("");
      setPage(1);
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (inv: RegistrationInvite) => {
    const url = inviteDisplayURL(inv);
    if (!url) {
      toast.error("آدرس لینک در دسترس نیست");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("لینک کپی شد");
    } catch {
      toast.error("کپی ممکن نشد");
    }
  };

  const pause = async (id: number) => {
    setActionBusy(id);
    try {
      await http.post(`/api/admin/invites/${id}/pause`, {});
      toast.success("لینک موقتاً متوقف شد");
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setActionBusy(null);
    }
  };

  const resume = async (id: number) => {
    setActionBusy(id);
    try {
      await http.post(`/api/admin/invites/${id}/resume`, {});
      toast.success("لینک دوباره فعال شد");
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setActionBusy(null);
    }
  };

  const revoke = async (id: number) => {
    setActionBusy(id);
    try {
      await http.post(`/api/admin/invites/${id}/revoke`, {});
      toast.success("لینک لغو شد");
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setActionBusy(null);
    }
  };

  const openEdit = (inv: RegistrationInvite) => {
    setEditing(inv);
    setEditLabel(inv.label ?? "");
    setEditMaxUses(inv.maxUses);
    setEditExpiresInDays("");
    setEditClearExpires(false);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (editMaxUses < editing.usedCount) {
      toast.error(`ظرفیت نمی‌تواند کمتر از ${formatFaNumber(editing.usedCount)} (استفاده‌شده) باشد`);
      return;
    }
    if (editMaxUses < 1 || editMaxUses > 10_000) {
      toast.error("ظرفیت باید بین ۱ تا ۱۰۰۰۰ باشد");
      return;
    }
    const labelErr = validateInviteLabel(editLabel);
    if (labelErr) {
      toast.error(labelErr);
      return;
    }
    setEditBusy(true);
    try {
      const body: {
        label: string;
        maxUses: number;
        expiresInDays?: number;
        clearExpires?: boolean;
      } = {
        label: editLabel.trim(),
        maxUses: editMaxUses,
      };
      if (editClearExpires) {
        body.clearExpires = true;
      } else {
        const days = Number(editExpiresInDays);
        if (editExpiresInDays.trim() && Number.isFinite(days) && days > 0) {
          body.expiresInDays = Math.floor(days);
        }
      }
      await http.put(`/api/admin/invites/${editing.id}`, body);
      toast.success("لینک به‌روز شد");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-base">ساخت لینک جدید</CardTitle>
          <p className="text-xs text-muted-foreground">
            ظرفیت، برچسب و مهلت اختیاری — لینک را بعد از ساخت کپی کنید.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="inv-max">ظرفیت (نفر)</Label>
              <Input
                id="inv-max"
                type="number"
                min={1}
                max={10000}
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
                dir="ltr"
                className="text-left"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inv-label">برچسب (اختیاری)</Label>
              <Input
                id="inv-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="مثلاً دوره بهار"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-exp">مهلت روز (اختیاری)</Label>
              <Input
                id="inv-exp"
                type="number"
                min={1}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                dir="ltr"
                className="text-left"
                placeholder="—"
              />
            </div>
          </div>
          <Button type="button" variant="gradient" disabled={busy} onClick={() => void create()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            ساخت لینک
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-base">لینک‌های عضویت</CardTitle>
          <p className="text-xs text-muted-foreground">مدیریت، کپی و توقف لینک‌های ساخته‌شده.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ListToolbar>
            <Input
              placeholder="جستجو با برچسب…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
            {q && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setQ("")}>
                پاک کردن
              </Button>
            )}
          </ListToolbar>
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && invites.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {q.trim() ? "نتیجه‌ای یافت نشد." : "هنوز لینک عضویتی ساخته نشده است."}
            </p>
          )}
          <div className="space-y-2">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {inv.label || `لینک #${formatFaNumber(inv.id)}`}
                    </p>
                    <Badge variant={statusBadgeVariant(inv.status)}>{STATUS_LABEL[inv.status]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    استفاده: {formatFaNumber(inv.usedCount)} / {formatFaNumber(inv.maxUses)}
                    {inv.status === "active" || inv.status === "paused"
                      ? ` · باقی‌مانده: ${formatFaNumber(inv.remaining)}`
                      : null}
                  </p>
                  {inv.expiresAt && (
                    <p className="text-[11px] text-muted-foreground">
                      انقضا: {new Date(inv.expiresAt).toLocaleString("fa-IR")}
                    </p>
                  )}
                  {inv.token && (
                    <p className="truncate font-mono text-[11px] text-muted-foreground" dir="ltr">
                      {inviteDisplayURL(inv)}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!inv.token && !inv.url}
                    onClick={() => void copy(inv)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    کپی
                  </Button>
                  {(inv.status === "active" || inv.status === "paused") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={actionBusy === inv.id}
                      onClick={() => openEdit(inv)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      ویرایش
                    </Button>
                  )}
                  {inv.status === "active" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={actionBusy === inv.id}
                      onClick={() => void pause(inv.id)}
                    >
                      {actionBusy === inv.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                      توقف موقت
                    </Button>
                  )}
                  {inv.status === "paused" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={actionBusy === inv.id}
                      onClick={() => void resume(inv.id)}
                    >
                      {actionBusy === inv.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      ازسرگیری
                    </Button>
                  )}
                  {(inv.status === "active" || inv.status === "paused") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={actionBusy === inv.id}
                      onClick={() => void revoke(inv.id)}
                    >
                      {actionBusy === inv.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" />
                      )}
                      لغو
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md sm:rounded-2xl">
          <DialogHeader className="text-start">
            <DialogTitle>ویرایش لینک عضویت</DialogTitle>
            <DialogDescription>
              ظرفیت و برچسب را تغییر دهید. ظرفیت نمی‌تواند کمتر از تعداد استفاده‌شده باشد.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">
                استفاده‌شده: {formatFaNumber(editing.usedCount)} از {formatFaNumber(editing.maxUses)}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="edit-label">برچسب</Label>
                <Input
                  id="edit-label"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="مثلاً دوره بهار"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-max">ظرفیت (نفر)</Label>
                <Input
                  id="edit-max"
                  type="number"
                  min={editing.usedCount || 1}
                  max={10000}
                  value={editMaxUses}
                  onChange={(e) => setEditMaxUses(Number(e.target.value) || 1)}
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-exp">مهلت جدید (روز از الان — اختیاری)</Label>
                <Input
                  id="edit-exp"
                  type="number"
                  min={1}
                  value={editExpiresInDays}
                  onChange={(e) => {
                    setEditExpiresInDays(e.target.value);
                    if (e.target.value.trim()) setEditClearExpires(false);
                  }}
                  dir="ltr"
                  className="text-left"
                  placeholder={editing.expiresAt ? "بدون تغییر" : "—"}
                  disabled={editClearExpires}
                />
              </div>
              {editing.expiresAt && (
                <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>حذف مهلت انقضا</span>
                  <Switch
                    checked={editClearExpires}
                    onCheckedChange={(v) => {
                      setEditClearExpires(v);
                      if (v) setEditExpiresInDays("");
                    }}
                    aria-label="حذف مهلت انقضا"
                  />
                </label>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={editBusy}>
              انصراف
            </Button>
            <Button type="button" variant="gradient" disabled={editBusy} onClick={() => void saveEdit()}>
              {editBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
