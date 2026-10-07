"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import type { CertificatePhysicalOrder, PhysicalCertSettings, PhysicalOrderStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/providers";
import { formatFaNumber } from "@/lib/utils";

const STATUS_LABEL: Record<PhysicalOrderStatus, string> = {
  requested: "درخواست‌شده",
  paid: "پرداخت‌شده",
  shipped: "ارسال‌شده",
  cancelled: "لغو",
};

const NEXT: Partial<Record<PhysicalOrderStatus, PhysicalOrderStatus>> = {
  requested: "paid",
  paid: "shipped",
};

export function PhysicalOrdersPanel() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [tracking, setTracking] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "physical-orders", statusFilter],
    queryFn: () =>
      http.get<{ orders: CertificatePhysicalOrder[]; physical: PhysicalCertSettings }>(
        `/api/admin/physical-orders?status=${encodeURIComponent(statusFilter)}`,
      ),
  });

  const update = async (id: number, status: PhysicalOrderStatus) => {
    setBusy(id);
    try {
      await http.put(`/api/admin/physical-orders/${id}`, {
        status,
        note: notes[id] ?? "",
        trackingCode: tracking[id] ?? "",
      });
      toast.success("وضعیت به‌روزرسانی شد — دانشجو مطلع می‌شود");
      qc.invalidateQueries({ queryKey: ["admin", "physical-orders"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">فهرست سفارش‌ها</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">همه</option>
            <option value="requested">درخواست‌شده</option>
            <option value="paid">پرداخت‌شده</option>
            <option value="shipped">ارسال‌شده</option>
            <option value="cancelled">لغو</option>
          </select>
          {data?.physical && (
            <span className="text-xs text-muted-foreground">
              قیمت: {formatFaNumber(data.physical.priceIrr)} ریال · پنجره:{" "}
              {formatFaNumber(data.physical.windowDays)} روز
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {(data?.orders ?? []).map((o) => (
          <div key={o.id} className="space-y-2 rounded-md border border-border px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{o.userName ?? `کاربر ${o.userId}`}</p>
                <p className="text-xs text-muted-foreground" dir="ltr">
                  #{o.id} · cert {o.publicId}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  مهلت پنجره: {new Date(o.windowEndsAt).toLocaleString("fa-IR")}
                </p>
                {(o.address || o.city) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[o.recipientName, o.phone, o.city, o.postalCode].filter(Boolean).join(" · ")}
                    <br />
                    {o.address}
                  </p>
                )}
                {o.trackingCode && (
                  <p className="text-xs font-mono" dir="ltr">
                    tracking: {o.trackingCode}
                  </p>
                )}
              </div>
              <Badge variant={o.status === "cancelled" ? "destructive" : "secondary"}>
                {STATUS_LABEL[o.status]}
              </Badge>
            </div>
            {o.note && <p className="text-xs text-muted-foreground">یادداشت: {o.note}</p>}
            <Input
              placeholder="یادداشت ادمین…"
              value={notes[o.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [o.id]: e.target.value }))}
            />
            {(o.status === "paid" || o.status === "shipped") && (
              <Input
                placeholder="کد پیگیری ارسال…"
                value={tracking[o.id] ?? o.trackingCode ?? ""}
                onChange={(e) => setTracking((t) => ({ ...t, [o.id]: e.target.value }))}
                dir="ltr"
              />
            )}
            <div className="flex flex-wrap gap-2">
              {NEXT[o.status] && (
                <Button size="sm" disabled={busy === o.id} onClick={() => update(o.id, NEXT[o.status]!)}>
                  {busy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  انتقال به {STATUS_LABEL[NEXT[o.status]!]}
                </Button>
              )}
              {o.status !== "cancelled" && o.status !== "shipped" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === o.id}
                  onClick={() => update(o.id, "cancelled")}
                >
                  لغو
                </Button>
              )}
            </div>
          </div>
        ))}
        {!isLoading && (data?.orders ?? []).length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">سفارشی نیست.</p>
        )}
      </CardContent>
    </Card>
  );
}
