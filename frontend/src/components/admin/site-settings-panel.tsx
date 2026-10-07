"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { HeartHandshake, Loader2, Package, Save, Settings2, Sparkles } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/providers";
import type { AdminTabId } from "@/components/admin/nav";

type SettingsMap = Record<string, string>;

type SponsorDraft = { name: string; url: string; blurb: string };

function SectionHeading({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Settings2;
  title: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1 border-b border-border pb-2">
      <p className="flex items-center gap-2 text-sm font-bold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SiteSettingsPanel({
  onNavigate,
}: {
  onNavigate?: (tab: AdminTabId) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<SettingsMap>({});
  const [sponsors, setSponsors] = useState<SponsorDraft[]>([]);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => http.get<{ settings: SettingsMap }>("/api/admin/settings"),
  });

  useEffect(() => {
    if (!data?.settings) return;
    setDraft(data.settings);
    try {
      const parsed = JSON.parse(data.settings.sponsors || "[]") as SponsorDraft[];
      setSponsors(
        Array.isArray(parsed)
          ? parsed.map((s) => ({
              name: s.name ?? "",
              url: s.url ?? "",
              blurb: s.blurb ?? "",
            }))
          : [],
      );
    } catch {
      setSponsors([]);
    }
  }, [data]);

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if ((draft.donation_note ?? "").trim().length > 2000) {
      toast.error("یادداشت دونیت خیلی طولانی است");
      return;
    }
    const price = Number(draft.physical_cert_price_irr);
    const days = Number(draft.physical_cert_window_days);
    if (!Number.isFinite(price) || price < 0) {
      toast.error("قیمت گواهینامه نامعتبر است");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      toast.error("مهلت گواهینامه باید بین ۱ تا ۳۶۵۰ روز باشد");
      return;
    }
    if (sponsors.length > 20) {
      toast.error("حداکثر ۲۰ اسپانسر مجاز است");
      return;
    }
    for (const s of sponsors) {
      if (!s.name.trim()) continue;
      if ([...s.name.trim()].length > 100) {
        toast.error("نام اسپانسر خیلی طولانی است");
        return;
      }
      if ([...s.blurb.trim()].length > 300) {
        toast.error("توضیح اسپانسر خیلی طولانی است");
        return;
      }
      if ([...s.url.trim()].length > 500) {
        toast.error("لینک اسپانسر خیلی طولانی است");
        return;
      }
    }
    setBusy(true);
    try {
      const settings = {
        ...draft,
        sponsors: JSON.stringify(
          sponsors
            .filter((s) => s.name.trim())
            .map((s) => ({
              name: s.name.trim(),
              url: s.url.trim(),
              blurb: s.blurb.trim(),
            })),
        ),
      };
      await http.put("/api/admin/settings", { settings });
      toast.success("تنظیمات ذخیره شد");
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["community"] });
      qc.invalidateQueries({ queryKey: ["sponsors"] });
      qc.invalidateQueries({ queryKey: ["auth", "register-status"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">گزینه‌های قابل ذخیره</CardTitle>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            ذخیره
          </Button>
        </CardHeader>
        <CardContent className="space-y-8">
          {onNavigate && (
            <section className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3">
              <p className="text-sm font-bold">ثبت‌نام و دسترسی</p>
              <p className="mt-1 text-xs text-muted-foreground">
                روشن/خاموش کردن ثبت‌نام عمومی، لینک عضویت، فهرست مجاز و فهرست سیاه در بخش جداگانه
                هستند.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => onNavigate("registration")}
              >
                رفتن به ثبت‌نام و دسترسی
              </Button>
            </section>
          )}

          <section className="space-y-3">
            <SectionHeading
              icon={HeartHandshake}
              title="حمایت / دونیت"
              hint="متن راهنما برای گفتگو با تیم دربارهٔ حمایت مالی"
            />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>فعال باشد</span>
              <Switch
                checked={(draft.donation_enabled ?? "true") === "true"}
                onCheckedChange={(v) => set("donation_enabled", v ? "true" : "false")}
                aria-label="حمایت مالی"
              />
            </label>
            <Textarea
              className="min-h-[96px]"
              value={draft.donation_note ?? ""}
              onChange={(e) => set("donation_note", e.target.value)}
              placeholder="متن راهنما برای دانشجو"
            />
          </section>

          <section className="space-y-3">
            <SectionHeading
              icon={Package}
              title="گواهینامه فیزیکی"
              hint="قیمت و مهلت سفارش گواهینامه چاپی پس از اتمام دوره"
            />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>فعال باشد</span>
              <Switch
                checked={(draft.physical_cert_enabled ?? "true") === "true"}
                onCheckedChange={(v) => set("physical_cert_enabled", v ? "true" : "false")}
                aria-label="گواهینامه فیزیکی"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                type="number"
                placeholder="قیمت (ریال)"
                value={draft.physical_cert_price_irr ?? ""}
                onChange={(e) => set("physical_cert_price_irr", e.target.value)}
                dir="ltr"
              />
              <Input
                type="number"
                placeholder="مهلت (روز)"
                value={draft.physical_cert_window_days ?? ""}
                onChange={(e) => set("physical_cert_window_days", e.target.value)}
                dir="ltr"
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <SectionHeading
                icon={Sparkles}
                title="اسپانسرهای لندینگ"
                hint="نام، لینک و توضیح کوتاه روی صفحه اصلی"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-2 shrink-0"
                onClick={() => setSponsors((s) => [...s, { name: "", url: "", blurb: "" }])}
              >
                افزودن
              </Button>
            </div>
            {sponsors.length === 0 && (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                هنوز اسپانسری ثبت نشده. با «افزودن» شروع کنید.
              </p>
            )}
            {sponsors.map((sp, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-border p-3">
                <Input
                  placeholder="نام"
                  value={sp.name}
                  onChange={(e) =>
                    setSponsors((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
                <Input
                  placeholder="https://…"
                  value={sp.url}
                  onChange={(e) =>
                    setSponsors((list) => list.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                  }
                  dir="ltr"
                />
                <Input
                  placeholder="توضیح کوتاه"
                  value={sp.blurb}
                  onChange={(e) =>
                    setSponsors((list) => list.map((x, j) => (j === i ? { ...x, blurb: e.target.value } : x)))
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setSponsors((list) => list.filter((_, j) => j !== i))}
                >
                  حذف
                </Button>
              </div>
            ))}
          </section>

          <p className="text-[11px] text-muted-foreground">
            رمزها، دیتابیس و JWT همچنان در فایل محیط (.env) می‌مانند — اینجا فقط تنظیمات قابل‌تغییر
            روزمره است.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
