"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BellRing, Loader2, Save } from "lucide-react";
import { http } from "@/lib/api";
import type { NotificationPrefs } from "@/lib/types";
import { NotificationsPanel } from "@/components/notifications-panel";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const prefsMeta: { key: keyof NotificationPrefs; title: string; desc: string }[] = [
  { key: "progress", title: "پیشرفت و باز شدن دروس", desc: "باز شدن آزمون، تکمیل درس، شاخه‌های جدید." },
  { key: "gamification", title: "بازی‌سازی", desc: "امتیاز، زنجیرهٔ فعالیت، لیگ‌ها و هشدار قلب." },
  { key: "mentor", title: "منتور و گفتگو", desc: "پاسخ منتور، پیام هم‌دوره‌ای، تایید رفع قفل." },
  { key: "event", title: "رویدادها و اطلاعیه‌ها", desc: "تایید ثبت‌نام و یادآوری ۱۵ دقیقه قبل از شروع." },
];

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["prefs"],
    queryFn: () => http.get<{ prefs: NotificationPrefs }>("/api/notifications/preferences"),
  });
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  const [prefs, setPrefs] = useState<{ prefs: NotificationPrefs }>();

  const prefsValue = draft ?? prefs?.prefs ?? data?.prefs;

  const save = useMutation({
    mutationFn: (p: NotificationPrefs) => http.put<{ prefs: NotificationPrefs }>("/api/notifications/preferences", p),
    onSuccess: (res) => {
      setPrefs(res);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["prefs"] });
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-soft">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
          <div className="mt-6 space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-6 w-11 rounded-full" />
              </div>
            ))}
            <div className="flex justify-end border-t border-border/70 pt-5">
              <Skeleton className="h-10 w-36 rounded-xl" />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const toggle = (key: keyof NotificationPrefs) => {
    if (!prefsValue) return;
    setDraft({ ...prefsValue, [key]: !prefsValue[key] });
  };

  const dirty = draft != null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        kicker="صندوق پیام و تنظیمات"
        title="اعلان‌ها"
        description="همه‌چیز درون‌برنامه و بی‌درنگ ارسال می‌شود — نیازی به ایمیل نیست."
      />

      <Panel
        title="دسته‌بندی اعلان‌ها"
        description="هر دسته را همان‌جا بی‌صدا کنید. تغییرات پس از ذخیره اعمال می‌شود."
        icon={<BellRing className="h-5 w-5" />}
        tint="bg-primary/10 text-primary"
      >
        <div className="space-y-6">
          {prefsValue &&
            prefsMeta.map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={`pref-${m.key}`} className="font-medium">{m.title}</Label>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </div>
                <Switch
                  id={`pref-${m.key}`}
                  checked={!!prefsValue[m.key]}
                  onCheckedChange={() => toggle(m.key)}
                />
              </div>
            ))}
          <div className="flex justify-end border-t border-border/70 pt-5">
            <Button
              className="gap-1.5"
              disabled={!dirty || save.isPending}
              onClick={() => draft && save.mutate(draft)}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              ذخیره تنظیمات
            </Button>
          </div>
        </div>
      </Panel>

      <NotificationsPanel />
    </div>
  );
}