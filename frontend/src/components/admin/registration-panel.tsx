"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Link2, Loader2, Phone, PhoneOff, Save, ShieldAlert, UserPlus } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/providers";
import type { AdminTabId } from "@/components/admin/nav";

type SettingsMap = Record<string, string>;

const RELATED: {
  id: AdminTabId;
  label: string;
  hint: string;
  icon: typeof Link2;
}[] = [
  {
    id: "invites",
    label: "لینک عضویت",
    hint: "دعوت با ظرفیت و مهلت، بدون نیاز به فهرست مجاز",
    icon: Link2,
  },
  {
    id: "whitelist",
    label: "فهرست مجاز",
    hint: "وقتی اجبار فهرست مجاز روشن باشد، فقط این شماره‌ها ثبت‌نام عمومی می‌کنند",
    icon: Phone,
  },
  {
    id: "blacklist",
    label: "فهرست سیاه",
    hint: "همیشه رد — برای ثبت‌نام عمومی و دعوت‌نامه",
    icon: PhoneOff,
  },
];

export function RegistrationPanel({ onNavigate }: { onNavigate: (tab: AdminTabId) => void }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [requireWhitelist, setRequireWhitelist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => http.get<{ settings: SettingsMap }>("/api/admin/settings"),
  });

  useEffect(() => {
    if (!data?.settings || dirty) return;
    setEnabled((data.settings.registration_enabled ?? "false") === "true");
    setRequireWhitelist((data.settings.registration_require_whitelist ?? "true") === "true");
  }, [data, dirty]);

  const save = async () => {
    if (!data?.settings) return;
    setBusy(true);
    try {
      await http.put("/api/admin/settings", {
        settings: {
          ...data.settings,
          registration_enabled: enabled ? "true" : "false",
          registration_require_whitelist: requireWhitelist ? "true" : "false",
        },
      });
      toast.success("تنظیمات ثبت‌نام ذخیره شد");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
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
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" /> دسترسی عمومی
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              ثبت‌نام در /register را روشن کنید و مشخص کنید آیا شماره باید حتماً در فهرست مجاز باشد.
              فهرست سیاه همیشه رد می‌کند.
            </p>
          </div>
          <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            ذخیره
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-bold">ثبت‌نام عمومی فعال باشد</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {enabled
                  ? "صفحه ثبت‌نام عمومی در دسترس است"
                  : "فقط لینک عضویت یا ورود حساب‌های موجود"}
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => {
                setEnabled(v);
                setDirty(true);
              }}
              aria-label="ثبت‌نام عمومی"
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-bold">اجبار فهرست مجاز</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {requireWhitelist
                  ? "فقط شماره‌های آزاد در فهرست مجاز می‌توانند ثبت‌نام عمومی کنند"
                  : "هر شماره‌ای (به‌جز فهرست سیاه) می‌تواند ثبت‌نام کند"}
              </p>
            </div>
            <Switch
              checked={requireWhitelist}
              onCheckedChange={(v) => {
                setRequireWhitelist(v);
                setDirty(true);
              }}
              aria-label="اجبار فهرست مجاز"
              disabled={!enabled}
            />
          </label>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>
              <span className="font-bold text-foreground">فهرست سیاه</span> همیشه اعمال می‌شود؛ حتی اگر اجبار
              فهرست مجاز خاموش باشد یا ثبت‌نام از لینک دعوت باشد.
            </p>
          </div>
        </CardContent>
      </Card>

      <div>
        <p className="mb-2 px-0.5 text-xs font-bold text-muted-foreground">ابزارهای مرتبط</p>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {RELATED.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 text-start transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <ArrowLeft className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="text-sm font-bold">{item.label}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{item.hint}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
