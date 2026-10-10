"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/providers";
import { formatFaNumber, formatJalaliStamp } from "@/lib/utils";

const PAGE_SIZE = 8;

type BotKey = {
  id: number;
  botId: number;
  name: string;
  createdAt: string;
  active: boolean;
  requestCount: number;
};

type BotList = {
  items: BotKey[];
  total: number;
  page: number;
  pageSize: number;
};

export function BotPanel() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [toggling, setToggling] = useState<number | null>(null);

  const listQ = useQuery({
    queryKey: ["admin-bots", page],
    queryFn: () => http.get<BotList>(`/api/admin/bots?page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pageSize = listQ.data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(Math.max(page, 1), totalPages);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("توکن کپی شد");
    } catch {
      toast.error("کپی ممکن نشد");
    }
  }

  function setActive(row: BotKey, active: boolean) {
    setToggling(row.id);
    void http
      .put(`/api/admin/bots/${row.id}`, { active })
      .then(() => {
        toast.success(active ? "کلید فعال شد" : "کلید متوقف شد");
        return qc.invalidateQueries({ queryKey: ["admin-bots"] });
      })
      .catch((e) => toast.error(toUserError(e, "تغییر وضعیت ممکن نشد")))
      .finally(() => setToggling(null));
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">کلید API</CardTitle>
            <p className="text-sm text-muted-foreground">توکن فقط یک بار نشان داده می‌شود.</p>
          </div>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/admin/bot-docs">
              <BookOpen className="h-3.5 w-3.5" />
              راهنما
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام ربات" />
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void http
                .post<{ token: string }>("/api/admin/bots", { name })
                .then((res) => {
                  setToken(res.token);
                  setName("");
                  setPage(1);
                  toast.success("ربات ساخته شد");
                  return qc.invalidateQueries({ queryKey: ["admin-bots"] });
                })
                .catch((e) => toast.error(toUserError(e, "ساخت ربات ممکن نشد")))
                .finally(() => setBusy(false));
            }}
          >
            ساخت ربات
          </Button>
          {token && (
            <div className="space-y-2 rounded-2xl border border-border bg-muted/30 p-3">
              <p className="text-sm text-muted-foreground">توکن فقط یک بار نشان داده می‌شود.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={token} dir="ltr" className="font-mono text-xs" aria-label="توکن ربات" />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => void copyToken()}>
                    کپی
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setToken("")}>
                    بستن
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">کلیدها</CardTitle>
        </CardHeader>
        <CardContent>
          {listQ.isPending ? (
            <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
          ) : listQ.isError ? (
            <p className="text-sm font-bold text-destructive">{toUserError(listQ.error, "بارگذاری کلیدها ممکن نشد")}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز کلیدی نیست.</p>
          ) : (
            <div className="space-y-3">
              <ul className="divide-y divide-border">
                {items.map((row) => (
                  <li key={row.id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-bold">{row.name || "ربات"}</p>
                      <p className="text-xs text-muted-foreground">{formatJalaliStamp(row.createdAt)}</p>
                      <p className="text-xs">
                        <span className={row.active ? "font-bold text-success" : "font-bold text-muted-foreground"}>
                          {row.active ? "فعال" : "متوقف"}
                        </span>
                        <span className="text-muted-foreground"> · {formatFaNumber(row.requestCount)} درخواست</span>
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={toggling === row.id}
                      onClick={() => setActive(row, !row.active)}
                    >
                      {row.active ? "توقف" : "فعال‌کردن"}
                    </Button>
                  </li>
                ))}
              </ul>
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                  <Button type="button" variant="outline" size="sm" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>
                    قبلی
                  </Button>
                  <p className="text-sm font-bold tabular-nums text-muted-foreground">
                    {formatFaNumber(pageSafe)} از {formatFaNumber(totalPages)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pageSafe >= totalPages}
                    onClick={() => setPage(pageSafe + 1)}
                  >
                    بعدی
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
