"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Ban, Copy, Download, Link2, Loader2, Upload } from "lucide-react";
import { API_URL, http, refreshSession, throwFromResponse, toUserError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/providers";
import { AdminSelect } from "@/components/admin/list-toolbar";
import { formatFaNumber } from "@/lib/utils";

type ChatExportToken = {
  id: number;
  label: string;
  expiresAt: string;
  revokedAt?: string | null;
  usedAt?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  active: boolean;
  token?: string;
  url?: string;
};

type ChatExportStats = {
  conversationCount: number;
  messageCount: number;
  attachmentBytes: number;
  bodyBytes: number;
  estimatedBytes: number;
};

function formatFaBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n < 1024) return `${formatFaNumber(n)} بایت`;
  if (n < 1024 * 1024) return `${formatFaNumber(Math.round(n / 1024))} کیلوبایت`;
  const mb = n / (1024 * 1024);
  if (mb < 1024) {
    const rounded = mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1).replace(/\.0$/, ""));
    return `${formatFaNumber(rounded, mb >= 10 ? 0 : 1)} مگابایت`;
  }
  const gb = mb / 1024;
  const rounded = gb >= 10 ? Math.round(gb) : Number(gb.toFixed(1).replace(/\.0$/, ""));
  return `${formatFaNumber(rounded, gb >= 10 ? 0 : 1)} گیگابایت`;
}

function formatFaDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ChatExportPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState<number | null>(null);
  const [expiresInHours, setExpiresInHours] = useState<1 | 24>(24);
  const [lastCreatedURL, setLastCreatedURL] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "chat-export", "tokens"],
    queryFn: () => http.get<{ items: ChatExportToken[] }>("/api/admin/chat-export/tokens"),
  });

  const { data: statsData } = useQuery({
    queryKey: ["admin", "chat-export", "stats"],
    queryFn: () => http.get<{ stats: ChatExportStats }>("/api/admin/chat-export/stats"),
  });

  const tokens = data?.items ?? [];
  const stats = statsData?.stats;

  const copyText = async (text: string, okMsg: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMsg);
    } catch {
      toast.error("کپی ممکن نشد");
    }
  };

  const downloadExport = async () => {
    setExportBusy(true);
    try {
      const doFetch = (token: string | null) =>
        fetch(`${API_URL}/api/admin/chat-export`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      let res = await doFetch(useAuth.getState().accessToken);
      if (res.status === 401 && (useAuth.getState().refreshToken || useAuth.getState().user)) {
        await refreshSession();
        res = await doFetch(useAuth.getState().accessToken);
      }
      if (!res.ok) {
        await throwFromResponse(res, "دانلود خروجی گفتگوها ممکن نشد");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("آرشیو ZIP گفتگوها دانلود شد");
    } catch (e) {
      toast.error(toUserError(e, "دانلود خروجی گفتگوها ممکن نشد"));
    } finally {
      setExportBusy(false);
    }
  };

  const restoreExport = async (file: File) => {
    setRestoreBusy(true);
    try {
      const isZip =
        file.name.toLowerCase().endsWith(".zip") ||
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed";
      const doFetch = async (token: string | null) => {
        if (isZip) {
          return fetch(`${API_URL}/api/admin/chat-export/restore`, {
            method: "POST",
            credentials: "include",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              "Content-Type": "application/zip",
            },
            body: file,
          });
        }
        const text = await file.text();
        const payload = JSON.parse(text) as unknown;
        return fetch(`${API_URL}/api/admin/chat-export/restore`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
      };
      let res = await doFetch(useAuth.getState().accessToken);
      if (res.status === 401 && (useAuth.getState().refreshToken || useAuth.getState().user)) {
        await refreshSession();
        res = await doFetch(useAuth.getState().accessToken);
      }
      if (!res.ok) {
        await throwFromResponse(res, "بازیابی خروجی گفتگوها ممکن نشد");
      }
      const data = (await res.json()) as { imported?: number };
      toast.success(`${formatFaNumber(data.imported ?? 0)} پیام بازیابی شد`);
      await qc.invalidateQueries({ queryKey: ["admin", "chat-export", "stats"] });
    } catch (e) {
      toast.error(toUserError(e, "بازیابی خروجی گفتگوها ممکن نشد"));
    } finally {
      setRestoreBusy(false);
    }
  };

  const createLink = async () => {
    setCreateBusy(true);
    try {
      const res = await http.post<{ token: ChatExportToken }>("/api/admin/chat-export/tokens", {
        expiresInHours,
      });
      const url = res.token?.url ?? "";
      setLastCreatedURL(url);
      if (url) {
        await copyText(url, "لینک دانلود ساخته و کپی شد");
      } else {
        toast.success("لینک دانلود ساخته شد");
      }
      await qc.invalidateQueries({ queryKey: ["admin", "chat-export", "tokens"] });
    } catch (e) {
      toast.error(toUserError(e, "ساخت لینک دانلود ممکن نشد"));
    } finally {
      setCreateBusy(false);
    }
  };

  const revokeLink = async (id: number) => {
    setRevokeBusy(id);
    try {
      await http.post(`/api/admin/chat-export/tokens/${id}/revoke`, {});
      toast.success("لینک لغو شد");
      await qc.invalidateQueries({ queryKey: ["admin", "chat-export", "tokens"] });
    } catch (e) {
      toast.error(toUserError(e, "لغو لینک ممکن نشد"));
    } finally {
      setRevokeBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">آرشیو گفتگوها</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            آرشیو فشردهٔ ZIP شامل <span className="font-medium text-foreground">manifest.json</span> و پوشهٔ{" "}
            <span className="font-medium text-foreground">attachments/</span> برای همه گفتگوهای دانشجو↔منتور.
          </p>
          {stats ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm leading-relaxed text-foreground">
              کل تاریخچه تقریباً{" "}
              <span className="font-medium">{formatFaBytes(stats.estimatedBytes)}</span> حجم دارد
              {" "}
              <span className="text-muted-foreground">
                ({formatFaNumber(stats.conversationCount)} گفتگو، {formatFaNumber(stats.messageCount)} پیام
                {stats.attachmentBytes > 0
                  ? `، حدود ${formatFaBytes(stats.attachmentBytes)} پیوست`
                  : ""}
                ). حجم فایل ZIP نزدیک همین مقدار است.
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void downloadExport()} disabled={exportBusy}>
              {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              دانلود آرشیو ZIP
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={restoreBusy}
              onClick={() => fileRef.current?.click()}
            >
              {restoreBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              بازیابی از ZIP یا JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/zip,application/x-zip-compressed,.zip,application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void restoreExport(f);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">لینک دانلود خارجی</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            لینک یک‌بارمصرف با مهلت محدود بسازید؛ همان آرشیو ZIP را بدون ورود ادمین می‌دهد و پس از اولین دانلود باطل می‌شود (لغو دستی هم ممکن است).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="export-ttl">مهلت اعتبار</Label>
              <AdminSelect
                id="export-ttl"
                value={String(expiresInHours)}
                onChange={(e) => setExpiresInHours(Number(e.target.value) === 1 ? 1 : 24)}
              >
                <option value="1">۱ ساعت</option>
                <option value="24">۲۴ ساعت</option>
              </AdminSelect>
            </div>
            <Button type="button" onClick={() => void createLink()} disabled={createBusy}>
              {createBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              ایجاد لینک دانلود
            </Button>
          </div>
          {lastCreatedURL ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                dir="ltr"
                className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-mono"
              >
                {lastCreatedURL}
              </code>
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyText(lastCreatedURL, "لینک کپی شد")}
              >
                <Copy className="h-4 w-4" />
                کپی
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium">لینک‌های فعال و اخیر</p>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
            ) : tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">هنوز لینکی ساخته نشده است.</p>
            ) : (
              <ul className="space-y-2">
                {tokens.map((tok) => (
                  <li
                    key={tok.id}
                    className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {tok.active ? (
                          <Badge variant="secondary">فعال</Badge>
                        ) : tok.revokedAt ? (
                          <Badge variant="destructive">لغو شده</Badge>
                        ) : tok.usedAt ? (
                          <Badge variant="outline">استفاده شده</Badge>
                        ) : (
                          <Badge variant="outline">منقضی</Badge>
                        )}
                        <span className="text-xs text-muted-foreground" dir="ltr">
                          تا {formatFaDate(tok.expiresAt)}
                        </span>
                      </div>
                      {tok.url ? (
                        <code dir="ltr" className="block truncate text-xs font-mono text-muted-foreground">
                          {tok.url}
                        </code>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tok.url ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void copyText(tok.url!, "لینک کپی شد")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          کپی
                        </Button>
                      ) : null}
                      {tok.active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={revokeBusy === tok.id}
                          onClick={() => void revokeLink(tok.id)}
                        >
                          {revokeBusy === tok.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Ban className="h-3.5 w-3.5" />
                          )}
                          لغو
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
