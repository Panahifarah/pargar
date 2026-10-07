"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import type { RegistrationBlacklistAttempt, RegistrationPhoneBlacklist } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/providers";
import { formatFaNumber } from "@/lib/utils";
import {
  DEFAULT_PAGE_SIZE,
  ListPagination,
  buildPageQuery,
  type Paginated,
} from "@/components/admin/list-pagination";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { useConfirm } from "@/components/admin/use-confirm";

const pathLabel: Record<string, string> = {
  public: "عمومی",
  invite: "دعوت",
};

type ImportResult = {
  inserted: number;
  skipped: number;
  invalid: number;
  rejected: number;
  rejectedPhones?: string[];
  removedWhitelist?: number;
  whitelistedConflicts?: string[];
};

export function BlacklistPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState<number | null>(null);
  const [listQ, setListQ] = useState("");
  const [historyQ, setHistoryQ] = useState("");
  const [listPage, setListPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [pendingConflicts, setPendingConflicts] = useState<string[]>([]);

  useEffect(() => {
    setListPage(1);
  }, [listQ]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyQ]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "phone-blacklist", listQ, listPage],
    queryFn: () => {
      const params = new URLSearchParams(buildPageQuery(listPage));
      if (listQ.trim()) params.set("q", listQ.trim());
      return http.get<Paginated<RegistrationPhoneBlacklist>>(
        `/api/admin/phone-blacklist?${params.toString()}`,
      );
    },
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["admin", "phone-blacklist", "attempts", historyQ, historyPage],
    queryFn: () => {
      const params = new URLSearchParams(buildPageQuery(historyPage));
      if (historyQ.trim()) params.set("q", historyQ.trim());
      return http.get<Paginated<RegistrationBlacklistAttempt>>(
        `/api/admin/phone-blacklist/attempts?${params.toString()}`,
      );
    },
  });

  const entries = useMemo(() => data?.items ?? [], [data]);
  const attempts = useMemo(() => historyData?.items ?? [], [historyData]);
  const listTotal = data?.total ?? 0;
  const listPageSize = data?.pageSize ?? DEFAULT_PAGE_SIZE;
  const historyTotal = historyData?.total ?? 0;
  const historyPageSize = historyData?.pageSize ?? DEFAULT_PAGE_SIZE;

  const summarizeImport = (res: ImportResult) => {
    const parts = [
      `${formatFaNumber(res.inserted)} افزوده`,
      res.skipped ? `${formatFaNumber(res.skipped)} تکراری` : null,
      res.removedWhitelist ? `${formatFaNumber(res.removedWhitelist)} از فهرست مجاز حذف` : null,
      res.invalid ? `${formatFaNumber(res.invalid)} نامعتبر` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      toast.success(parts.join(" · "));
    }
    if (res.rejected > 0) {
      const phones = res.rejectedPhones ?? [];
      const detail =
        phones.length > 0
          ? ` (${phones.slice(0, 3).join("، ")}${phones.length > 3 ? "…" : ""})`
          : "";
      toast.error(
        `${formatFaNumber(res.rejected)} شماره قبلاً ثبت‌نام شده و قابل انتقال به فهرست سیاه نیست${detail}`,
      );
    }
  };

  const postImport = async (payload: {
    text?: string;
    phones?: string[];
    resolveConflicts?: boolean;
  }) => {
    return http.post<ImportResult>("/api/admin/phone-blacklist/import", payload);
  };

  const finishImport = (res: ImportResult) => {
    summarizeImport(res);
    setText("");
    setPendingConflicts([]);
    setListPage(1);
    qc.invalidateQueries({ queryKey: ["admin", "phone-blacklist"] });
    if (res.removedWhitelist) {
      qc.invalidateQueries({ queryKey: ["admin", "phone-whitelist"] });
    }
  };

  const importPhones = async () => {
    if (!text.trim()) {
      toast.error("حداقل یک شماره وارد کنید");
      return;
    }
    setBusy(true);
    setPendingConflicts([]);
    try {
      const res = await postImport({ text });
      const conflicts = res.whitelistedConflicts ?? [];
      if (conflicts.length > 0) {
        summarizeImport(res);
        if (conflicts.length === 1) {
          const phone = conflicts[0];
          const ok = await confirm(
            "این شماره در فهرست مجاز است",
            `شماره ${phone} در فهرست مجاز است. حذف از فهرست مجاز و افزودن به فهرست سیاه؟`,
            "حذف از فهرست مجاز و افزودن",
          );
          if (!ok) {
            setPendingConflicts(conflicts);
            return;
          }
          const resolved = await postImport({ phones: conflicts, resolveConflicts: true });
          finishImport(resolved);
          return;
        }
        setPendingConflicts(conflicts);
        toast.error(
          `${formatFaNumber(conflicts.length)} شماره در فهرست مجاز است — برای ادامه تعارض را حل کنید`,
        );
        return;
      }
      finishImport(res);
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(false);
    }
  };

  const resolveConflicts = async () => {
    if (pendingConflicts.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const res = await postImport({ phones: pendingConflicts, resolveConflicts: true });
      finishImport(res);
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setDeleteBusy(id);
    try {
      await http.del(`/api/admin/phone-blacklist/${id}`);
      toast.success("شماره از فهرست سیاه حذف شد");
      qc.invalidateQueries({ queryKey: ["admin", "phone-blacklist"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setDeleteBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {dialog}
      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-base">واردات شماره</CardTitle>
          <p className="text-xs text-muted-foreground">
            این شماره‌ها همیشه رد می‌شوند — ثبت‌نام عمومی و دعوت‌نامه. اگر شماره در فهرست مجاز باشد، قبل
            از انتقال تأیید می‌گیریم. فرمت: هر خط یا جدا با ویرگول.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bl-text">شماره‌ها</Label>
            <Textarea
              id="bl-text"
              className="min-h-[120px] text-left tracking-wide"
              dir="ltr"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"09121234567\n09129876543"}
            />
          </div>
          <Button type="button" variant="gradient" disabled={busy} onClick={() => void importPhones()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            واردات
          </Button>
          {pendingConflicts.length > 0 && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium">این شماره در فهرست مجاز است</p>
              <p className="text-xs text-muted-foreground">
                حذف از فهرست مجاز و افزودن به فهرست سیاه؟
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm tracking-wide" dir="ltr">
                {pendingConflicts.map((phone) => (
                  <li key={phone}>{phone}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="gradient"
                  disabled={busy}
                  onClick={() => void resolveConflicts()}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  حل تعارض و ادامه
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPendingConflicts([])}
                >
                  انصراف
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-base">فهرست سیاه</CardTitle>
          <p className="text-xs text-muted-foreground">جستجو و مدیریت شماره‌های مسدود.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ListToolbar>
            <Input
              placeholder="جستجو با شماره…"
              value={listQ}
              onChange={(e) => setListQ(e.target.value)}
              className="max-w-xs text-left tracking-wide"
              dir="ltr"
            />
            {listQ && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setListQ("")}>
                پاک کردن
              </Button>
            )}
          </ListToolbar>

          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && entries.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              هنوز شماره‌ای در فهرست سیاه نیست.
            </p>
          )}
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium tracking-wide" dir="ltr">
                    {entry.phone}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    افزوده: {new Date(entry.createdAt).toLocaleString("fa-IR")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={deleteBusy === entry.id}
                  onClick={() => void remove(entry.id)}
                >
                  {deleteBusy === entry.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  حذف
                </Button>
              </div>
            ))}
          </div>
          <ListPagination
            page={listPage}
            pageSize={listPageSize}
            total={listTotal}
            onPageChange={setListPage}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-base">تاریخچه تلاش</CardTitle>
          <p className="text-xs text-muted-foreground">
            تلاش‌های ثبت‌نام با شمارهٔ مسدود — فقط برای ممیزی ثبت می‌شوند.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ListToolbar>
            <Input
              id="bl-hist-q"
              value={historyQ}
              onChange={(e) => setHistoryQ(e.target.value)}
              dir="ltr"
              className="max-w-sm text-left tracking-wide"
              placeholder="۰۹۱۲… یا نام کاربری"
            />
            {historyQ && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setHistoryQ("")}>
                پاک کردن
              </Button>
            )}
          </ListToolbar>

          {historyLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!historyLoading && attempts.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              هنوز تلاشی ثبت نشده است.
            </p>
          )}
          <div className="space-y-2">
            {attempts.map((a) => (
              <div
                key={a.id}
                className="space-y-1 rounded-lg border border-border px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium tracking-wide" dir="ltr">
                    {a.phone}
                  </p>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {pathLabel[a.path] ?? a.path}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(a.attemptedAt).toLocaleString("fa-IR")}
                  {a.ip ? ` · IP: ${a.ip}` : ""}
                </p>
                {(a.attemptedUsername || a.attemptedEmail) && (
                  <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
                    {[a.attemptedUsername, a.attemptedEmail].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
          <ListPagination
            page={historyPage}
            pageSize={historyPageSize}
            total={historyTotal}
            onPageChange={setHistoryPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
