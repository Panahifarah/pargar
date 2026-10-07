"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Trophy } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JalaliDateTimePicker, isValidIsoRange } from "@/components/ui/jalali-datetime-picker";
import { useConfirm } from "@/components/admin/use-confirm";
import { toast } from "@/components/providers";
import { formatFaNumber } from "@/lib/utils";

export type AdminChallenge = {
  id: number;
  title: string;
  description: string;
  targetXp: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  createdAt: string;
};

export function ChallengesPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [modal, setModal] = useState<AdminChallenge | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "challenges"],
    queryFn: () => http.get<{ challenges: AdminChallenge[] }>("/api/admin/challenges"),
  });

  const save = async (c: AdminChallenge) => {
    if (!isValidIsoRange(c.startsAt, c.endsAt)) {
      toast.error("زمان پایان باید پس از زمان شروع باشد");
      return;
    }
    if (!c.targetXp || c.targetXp <= 0) {
      toast.error("هدف امتیاز باید بزرگ‌تر از صفر باشد");
      return;
    }
    try {
      const { createdAt: _c, ...body } = c;
      if (c.id) await http.put(`/api/admin/challenges/${c.id}`, body);
      else await http.post("/api/admin/challenges", body);
      setModal(null);
      qc.invalidateQueries({ queryKey: ["admin", "challenges"] });
      qc.invalidateQueries({ queryKey: ["challenges"] });
      toast.success(c.id ? "چالش به‌روزرسانی شد" : "چالش ساخته شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const del = async (c: AdminChallenge) => {
    if (!(await confirm("حذف چالش", `چالش «${c.title}» حذف شود؟`))) return;
    try {
      await http.del(`/api/admin/challenges/${c.id}`);
      qc.invalidateQueries({ queryKey: ["admin", "challenges"] });
      toast.success("چالش حذف شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("fa-IR", {
      weekday: "short",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <>
      {dialog}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">چالش‌های امتیاز</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              چالش ماهانه با هدف امتیاز؛ پیشرفت هنرجو با تکمیل آزمون‌ها به‌روز می‌شود.
            </p>
          </div>
          <Button
            className="gap-1.5"
            onClick={() =>
              setModal({
                id: 0,
                title: "",
                description: "",
                targetXp: 500,
                startsAt: "",
                endsAt: "",
                isActive: true,
                createdAt: "",
              })
            }
          >
            <Plus className="h-4 w-4" /> چالش جدید
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          )}
          {isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">{toUserError(error)}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
                تلاش دوباره
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(data?.challenges ?? []).map((c) => (
              <div key={c.id} className="rounded-md border border-border p-4">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-gold" />
                  <Badge variant={c.isActive ? "success" : "secondary"}>{c.isActive ? "فعال" : "خاموش"}</Badge>
                  <Badge variant="accent">هدف {formatFaNumber(c.targetXp)} امتیاز</Badge>
                  <div className="ms-auto flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setModal({ ...c })}>
                      ویرایش
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => del(c)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="mt-2 font-medium">{c.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{c.description || "—"}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {fmt(c.startsAt)} تا {fmt(c.endsAt)}
                </p>
              </div>
            ))}
          </div>
          {!isLoading && !isError && (data?.challenges ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">هنوز چالشی نیست.</p>
          )}
        </CardContent>
        <ChallengeDialog challenge={modal} onClose={() => setModal(null)} onSave={save} />
      </Card>
    </>
  );
}

function ChallengeDialog({
  challenge,
  onClose,
  onSave,
}: {
  challenge: AdminChallenge | null;
  onClose: () => void;
  onSave: (c: AdminChallenge) => void;
}) {
  const [draft, setDraft] = useState<AdminChallenge | null>(challenge);
  useEffect(() => setDraft(challenge), [challenge]);
  const set = (patch: Partial<AdminChallenge>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const valid =
    !!draft?.title.trim() &&
    !!draft?.startsAt &&
    !!draft?.endsAt &&
    (draft?.targetXp ?? 0) > 0 &&
    isValidIsoRange(draft!.startsAt, draft!.endsAt);

  return (
    <Dialog open={!!challenge} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft?.id ? "ویرایش چالش" : "چالش جدید"}</DialogTitle>
          <DialogDescription>بازه را با تقویم جلالی تنظیم کنید؛ هنرجویان پیشرفت تا هدف امتیاز را می‌بینند.</DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>عنوان</Label>
              <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="مثلاً چالش ماه مهر" />
            </div>
            <div className="space-y-1.5">
              <Label>توضیحات</Label>
              <textarea
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                rows={3}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="هدف و انگیزهٔ چالش…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>هدف امتیاز</Label>
              <Input
                type="number"
                dir="ltr"
                min={1}
                value={draft.targetXp}
                onChange={(e) => set({ targetXp: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>شروع (جلالی)</Label>
                <JalaliDateTimePicker value={draft.startsAt} onChange={(iso) => set({ startsAt: iso })} aria-label="شروع چالش" />
              </div>
              <div className="space-y-1.5">
                <Label>پایان (جلالی)</Label>
                <JalaliDateTimePicker value={draft.endsAt} onChange={(iso) => set({ endsAt: iso })} aria-label="پایان چالش" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">فعال</p>
                <p className="text-[11px] text-muted-foreground">فقط چالش‌های فعال در بازهٔ زمانی به هنرجو نشان داده می‌شوند</p>
              </div>
              <Switch checked={draft.isActive} onCheckedChange={(v) => set({ isActive: v })} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            انصراف
          </Button>
          <Button disabled={!valid} onClick={() => draft && onSave(draft)}>
            ذخیره چالش
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
