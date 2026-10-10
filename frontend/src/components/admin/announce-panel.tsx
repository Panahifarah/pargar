"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Calendar,
  Eye,
  Gamepad2,
  Loader2,
  Megaphone,
  Route,
  Settings2,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/components/providers";
import { SafeMarkdown } from "@/components/safe-markdown";

const CATEGORIES = [
  { id: "event", label: "رویداد", icon: Calendar, hint: "جلسه زنده، کارگاه، ددلاین" },
  { id: "progress", label: "پیشرفت", icon: TrendingUp, hint: "درس جدید، فصل بازشده" },
  { id: "gamification", label: "بازی‌سازی", icon: Gamepad2, hint: "جایزه، استریک، چالش" },
  { id: "mentor", label: "منتور", icon: Users, hint: "پیام مستقیم تیم منتور" },
  { id: "urgent", label: "فوری", icon: AlertTriangle, hint: "نیاز به توجه همین حالا" },
  { id: "curriculum", label: "درس", icon: BookOpen, hint: "محتوای آموزشی" },
  { id: "community", label: "جامعه", icon: Users, hint: "فضای مشترک دوره" },
  { id: "system", label: "سیستم", icon: Settings2, hint: "وضعیت خود پرگار" },
] as const;

type Announcement = {
  id: number;
  title: string;
  body: string;
  category: string;
  route: string;
  pinned: boolean;
};

const ROUTES = [
  { path: "/unwrap", label: "نقشه مسیر" },
  { path: "/notifications", label: "اعلان‌ها" },
  { path: "/leaderboard", label: "لیدربورد" },
  { path: "/cap", label: "داشبورد" },
];

function announcementExcerpt(body: string) {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= 180) return plain;
  return `${plain.slice(0, 180).trimEnd()}…`;
}

function PreviewCard({
  title,
  body,
  category,
  route,
}: {
  title: string;
  body: string;
  category: string;
  route: string;
}) {
  const cat = CATEGORIES.find((c) => c.id === category);
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <div className="flex h-8 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Megaphone className="h-4 w-4" />
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {cat?.label ?? category}
        </Badge>
      </div>
      <p className="mt-2.5 text-sm font-black leading-snug">{title.trim() || "عنوان اطلاعیه"}</p>
      <SafeMarkdown
        text={body.trim() || "متن پیام اینجا دیده می‌شود…"}
        className="mt-1 min-h-[2.5rem] space-y-1 text-xs leading-relaxed text-muted-foreground"
      />
      <p className="mt-2.5 truncate text-[10px] font-mono text-primary" dir="ltr">
        → {route || "/"}
      </p>
    </div>
  );
}

export function AnnouncePanel() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("event");
  const [route, setRoute] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: () => http.get<{ announcements: Announcement[] }>("/api/admin/announcements"),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastSent, setLastSent] = useState<{ title: string; recipients: number } | null>(null);

  const titleOk = title.trim().length >= 3;
  const bodyOk = body.trim().length >= 8;
  const valid = titleOk && bodyOk;

  const send = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const payload = { title: title.trim(), body: body.trim(), category, route: route.trim(), pinned };
      if (editingId) {
        await http.put(`/api/admin/announcements/${editingId}`, payload);
        toast.success("اطلاعیه به‌روز شد");
      } else {
        const res = await http.post<{ recipients: number }>("/api/admin/announce", payload);
        toast.success(`اطلاعیه برای ${res.recipients} نفر ارسال شد`);
        setLastSent({ title: title.trim(), recipients: res.recipients });
      }
      setTitle("");
      setBody("");
      setPinned(false);
      setEditingId(null);
      setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    } catch (e) {
      toast.error(toUserError(e, "ارسال اطلاعیه ممکن نشد"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-6">
      <div data-announce-compose className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">نگارش اعلان</CardTitle>
            <p className="text-xs text-muted-foreground">
              به همه هنرجویان فعال می‌رسد و در مرکز اعلان‌ها دیده می‌شود.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-bold">عنوان</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثلاً جلسه زنده هفته ۴ · پنجشنبه ۲۰:۰۰"
                className={cn("h-11 rounded-2xl", !titleOk && title.length > 0 && "border-destructive")}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <div className="flex h-5 items-center justify-between gap-3">
                <Label className="text-sm font-bold">پیام</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">{body.length}/۴۰۰۰</span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 4000))}
                rows={5}
                maxLength={4000}
                className={cn(
                  "w-full resize-y rounded-xl border bg-background px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary",
                  !bodyOk && body.length > 0 ? "border-destructive/50" : "border-input"
                )}
                placeholder="یک جملهٔ واضح و کوتاه — لینک یا زمان را حتماً بگویید…"
              />
              {body.trim().length > 0 && body.trim().length < 8 && (
                <p className="text-xs font-bold text-destructive">پیام حداقل چند کلمه باشد.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-bold">دسته</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {CATEGORIES.map((c) => {
                  const active = category === c.id;
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className={cn(
                        "grid h-[4.25rem] grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl border px-3 text-right transition-colors",
                        active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-9 w-9 place-items-center rounded-xl",
                          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-extrabold">{c.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{c.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex h-5 items-center gap-1.5 text-sm font-bold">
                <Route className="h-3.5 w-3.5" /> با زدن اعلان این صفحه باز می‌شود
              </Label>
              <p className="text-[11px] text-muted-foreground">خالی بگذارید تا اعلان فقط خوانده شود و صفحه‌ای باز نکند.</p>
              <div className="flex flex-wrap gap-2">
                {ROUTES.map((r) => (
                  <button
                    key={r.path}
                    type="button"
                    onClick={() => setRoute(r.path)}
                    className={cn(
                      "inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition-colors",
                      route === r.path
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <Input
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                dir="ltr"
                className="h-10 rounded-2xl font-mono text-xs"
                placeholder="خالی مجاز است"
              />
              <label className="flex items-center gap-2 text-sm font-bold">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                سنجاق روی درخت مهارت
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button
                size="lg"
                className="h-11 gap-2"
                disabled={!valid}
                onClick={() => setConfirmOpen(true)}
              >
                <Eye className="h-4 w-4" />
                پیش‌نمایش و ارسال
              </Button>
              {!valid && (
                <p className="text-xs text-muted-foreground">عنوان و پیام را کامل کنید تا ادامه فعال شود.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border bg-muted/20">
            <CardHeader className="space-y-1 pb-3">
              <CardTitle className="flex h-6 items-center gap-2 text-sm">
                <Eye className="h-3.5 w-3.5" /> پیش‌نمایش زنده
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">هم‌زمان با تایپ به‌روز می‌شود.</p>
            </CardHeader>
            <CardContent>
              <PreviewCard title={title} body={body} category={category} route={route} />
            </CardContent>
          </Card>

          {lastSent && (
            <Card className="border border-success/40 bg-success/5">
              <CardContent className="space-y-1 pt-5 text-sm">
                <p className="font-bold text-success">آخرین ارسال موفق</p>
                <p className="truncate font-extrabold">{lastSent.title}</p>
                <p className="text-xs text-muted-foreground">{lastSent.recipients} گیرنده</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card data-announce-list className="rounded-2xl border border-border">
        <CardHeader>
          <CardTitle className="text-base">اطلاعیه‌های ثبت‌شده</CardTitle>
        </CardHeader>
        <CardContent>
          {(listQ.data?.announcements ?? []).length > 0 ? (
            <ul className="flex list-none flex-col gap-3 p-0">
              {(listQ.data?.announcements ?? []).map((a) => {
                const cat = CATEGORIES.find((c) => c.id === a.category);
                const excerpt = announcementExcerpt(a.body);
                return (
                  <li key={a.id} className="rounded-2xl border border-border bg-background p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 text-sm font-bold leading-snug">{a.title}</p>
                          <Badge variant="secondary" className="text-[10px]">
                            {cat?.label ?? a.category}
                          </Badge>
                          {a.pinned ? (
                            <Badge variant="gold" className="text-[10px]">
                              سنجاق
                            </Badge>
                          ) : null}
                        </div>
                        {excerpt ? (
                          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{excerpt}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(a.id);
                            setTitle(a.title);
                            setBody(a.body);
                            setCategory(a.category);
                            setRoute(a.route);
                            setPinned(a.pinned);
                          }}
                        >
                          ویرایش
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label="حذف"
                          onClick={() => {
                            void http
                              .del(`/api/admin/announcements/${a.id}`)
                              .then(() => qc.invalidateQueries({ queryKey: ["admin-announcements"] }))
                              .catch((e) => toast.error(toUserError(e, "حذف ممکن نشد")));
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : !listQ.isPending ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              هنوز اطلاعیه‌ای ثبت نشده است.
            </p>
          ) : null}
        </CardContent>
      </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-start">
            <DialogTitle className="text-lg font-black">تأیید ارسال</DialogTitle>
            <DialogDescription>این پیش‌نمایش نهایی است؛ بعد از تأیید برای همه ارسال می‌شود.</DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5">
            <PreviewCard title={title} body={body} category={category} route={route} />
          </div>
          <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:space-x-0">
            <Button variant="outline" className="h-10" onClick={() => setConfirmOpen(false)} disabled={busy}>
              بازگشت
            </Button>
            <Button className="h-10 gap-2" disabled={busy || !valid} onClick={() => void send()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              {editingId ? "تأیید و ذخیره" : "تأیید و ارسال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
