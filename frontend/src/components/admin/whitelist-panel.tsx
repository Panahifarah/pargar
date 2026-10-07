"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import type { RegistrationPhoneWhitelist, WhitelistStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const STATUS_LABEL: Record<WhitelistStatus, string> = {
  available: "آزاد",
  consumed: "مصرف‌شده",
};

type StatusFilter = "" | WhitelistStatus;

type ImportResult = {
  inserted: number;
  skipped: number;
  invalid: number;
  rejected?: number;
  rejectedPhones?: string[];
  blacklistedConflicts?: string[];
  removedBlacklist?: number;
};

export function WhitelistPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState<number | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<string[]>([]);

  useEffect(() => {
    setPage(1);
  }, [filter, q]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "phone-whitelist", filter, q, page],
    queryFn: () => {
      const params = new URLSearchParams(buildPageQuery(page));
      if (filter) params.set("status", filter);
      if (q.trim()) params.set("q", q.trim());
      return http.get<Paginated<RegistrationPhoneWhitelist>>(
        `/api/admin/phone-whitelist?${params.toString()}`,
      );
    },
  });

  const entries = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? DEFAULT_PAGE_SIZE;
  const availableCount = useMemo(
    () => entries.filter((e) => e.status === "available").length,
    [entries],
  );

  const summarizeImport = (res: ImportResult) => {
    const parts = [
      `${formatFaNumber(res.inserted)} افزوده`,
      res.skipped ? `${formatFaNumber(res.skipped)} تکراری` : null,
      res.removedBlacklist
        ? `${formatFaNumber(res.removedBlacklist)} از فهرست سیاه حذف`
        : null,
      res.invalid ? `${formatFaNumber(res.invalid)} نامعتبر` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      toast.success(parts.join(" · "));
    }
    if ((res.rejected ?? 0) > 0) {
      const phones = res.rejectedPhones ?? [];
      const detail =
        phones.length > 0
          ? ` (${phones.slice(0, 3).join("، ")}${phones.length > 3 ? "…" : ""})`
          : "";
      toast.error(
        `${formatFaNumber(res.rejected ?? 0)} شماره قبلاً ثبت‌نام شده و قابل افزودن به فهرست مجاز نیست${detail}`,
      );
    }
  };

  const postImport = async (payload: {
    text?: string;
    phones?: string[];
    resolveConflicts?: boolean;
  }) => {
    return http.post<ImportResult>("/api/admin/phone-whitelist/import", payload);
  };

  const finishImport = (res: ImportResult) => {
    summarizeImport(res);
    setText("");
    setPendingConflicts([]);
    setPage(1);
    qc.invalidateQueries({ queryKey: ["admin", "phone-whitelist"] });
    if (res.removedBlacklist) {
      qc.invalidateQueries({ queryKey: ["admin", "phone-blacklist"] });
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
      const conflicts = res.blacklistedConflicts ?? [];
      if (conflicts.length > 0) {
        summarizeImport(res);
        if (conflicts.length === 1) {
          const phone = conflicts[0];
          const ok = await confirm(
            "این شماره در فهرست سیاه است",
            `شماره ${phone} در فهرست سیاه است. حذف از فهرست سیاه و افزودن به فهرست مجاز؟`,
            "حذف از فهرست سیاه و افزودن",
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
          `${formatFaNumber(conflicts.length)} شماره در فهرست سیاه است — برای ادامه تعارض را حل کنید`,
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
      await http.del(`/api/admin/phone-whitelist/${id}`);
      toast.success("شماره از فهرست حذف شد");
      qc.invalidateQueries({ queryKey: ["admin", "phone-whitelist"] });
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
            هر شماره پس از یک ثبت‌نام موفق مصرف می‌شود. فرمت: هر خط یا جدا با ویرگول.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wl-text">شماره‌ها</Label>
            <Textarea
              id="wl-text"
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
              <p className="text-sm font-medium">این شماره در فهرست سیاه است</p>
              <p className="text-xs text-muted-foreground">
                حذف از فهرست سیاه و افزودن به فهرست مجاز؟
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
          <CardTitle className="text-base">فهرست مجاز</CardTitle>
          <p className="text-xs text-muted-foreground">جستجو و فیلتر شماره‌های ثبت‌شده.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ListToolbar>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["", "همه"],
                  ["available", "آزاد"],
                  ["consumed", "مصرف‌شده"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value || "all"}
                  type="button"
                  size="sm"
                  variant={filter === value ? "default" : "outline"}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Input
              placeholder="جستجو با شماره…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs text-left tracking-wide"
              dir="ltr"
            />
            {(q || filter) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQ("");
                  setFilter("");
                }}
              >
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
              هنوز شماره‌ای در فهرست نیست.
            </p>
          )}
          {!isLoading && entries.length > 0 && filter === "" && (
            <p className="text-xs text-muted-foreground">
              آزاد در این صفحه: {formatFaNumber(availableCount)} از {formatFaNumber(entries.length)}
            </p>
          )}
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium tracking-wide" dir="ltr">
                      {entry.phone}
                    </p>
                    <Badge variant={entry.status === "available" ? "secondary" : "outline"}>
                      {STATUS_LABEL[entry.status]}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    افزوده: {new Date(entry.createdAt).toLocaleString("fa-IR")}
                    {entry.consumedAt
                      ? ` · مصرف: ${new Date(entry.consumedAt).toLocaleString("fa-IR")}`
                      : null}
                  </p>
                </div>
                {entry.status === "available" && (
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
                )}
              </div>
            ))}
          </div>
          <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
