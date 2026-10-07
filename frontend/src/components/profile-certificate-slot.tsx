"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Copy, ExternalLink, Loader2, Lock, Package } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import type { Certificate, CertificatePhysicalOrder, PhysicalCertSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/providers";
import { cn, formatFaNumber } from "@/lib/utils";

type MineCertificateResponse = {
  certificate: Certificate | null;
  eligible: boolean;
  physicalOrder: CertificatePhysicalOrder | null;
  physical: PhysicalCertSettings;
};

const ORDER_LABEL: Record<string, string> = {
  requested: "درخواست فیزیکی ثبت شد",
  paid: "پرداخت تأیید شد",
  shipped: "ارسال شد",
  cancelled: "درخواست فیزیکی لغو شده",
};

export function ProfileCertificateSlot() {
  const router = useRouter();
  const qc = useQueryClient();
  const [issuing, setIssuing] = useState(false);
  const autoIssueTried = useRef(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["me", "certificate"],
    queryFn: () => http.get<MineCertificateResponse>("/api/me/certificate"),
  });

  const cert = data?.certificate ?? null;
  const eligible = !!data?.eligible;
  const physical = data?.physical;
  const order = data?.physicalOrder;

  // Auto-issue once when the student becomes eligible (same path as /cap).
  useEffect(() => {
    if (!eligible || cert || autoIssueTried.current) return;
    autoIssueTried.current = true;
    setIssuing(true);
    void http
      .post<{ certificate: Certificate }>("/api/me/certificate/issue", {})
      .then(() => qc.invalidateQueries({ queryKey: ["me", "certificate"] }))
      .catch((e) => toast.error(toUserError(e, "صدور خودکار گواهینامه ممکن نشد — دستی تلاش کنید")))
      .finally(() => setIssuing(false));
  }, [eligible, cert, qc]);

  const copyLink = async () => {
    if (!cert?.publicId) return;
    const url = `${window.location.origin}/c/${cert.publicId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("لینک گواهینامه کپی شد");
    } catch {
      toast.error("کپی ممکن نشد");
    }
  };

  const openCert = () => {
    if (!cert?.publicId) return;
    router.push(`/c/${cert.publicId}`);
  };

  const claim = async () => {
    setIssuing(true);
    try {
      const res = await http.post<{ certificate: Certificate }>("/api/me/certificate/issue", {});
      await qc.invalidateQueries({ queryKey: ["me", "certificate"] });
      if (res.certificate?.publicId) {
        router.push(`/c/${res.certificate.publicId}`);
      }
    } catch (e) {
      toast.error(toUserError(e, "صدور گواهینامه ممکن نشد"));
    } finally {
      setIssuing(false);
    }
  };

  const physicalOpen =
    !!physical?.enabled &&
    !!cert &&
    (!order || order.status === "cancelled") &&
    (!cert.issuedAt ||
      Date.now() <
        new Date(cert.issuedAt).getTime() + (physical.windowDays || 30) * 24 * 60 * 60 * 1000);

  return (
    <section
      aria-label="جایگاه گواهینامه"
      className="rounded-xl border border-dashed border-border bg-muted/20 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Award className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold">گواهینامه پایان دوره</p>
          <p className="text-[10px] text-muted-foreground">جایگاه ثابت گواهی شما در پروفایل</p>
        </div>
      </div>

      {isError ? (
        <div className="space-y-2 py-2 text-xs">
          <p className="font-medium text-destructive">{toUserError(error)}</p>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => refetch()}>
            تلاش دوباره
          </Button>
        </div>
      ) : isLoading || (eligible && !cert && issuing) ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          در حال بارگذاری…
        </div>
      ) : cert ? (
        <div className="space-y-2.5">
          <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
            <p className="text-sm font-bold text-foreground">{cert.fullName}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              صادر شده در {new Date(cert.issuedAt).toLocaleDateString("fa-IR")}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" dir="ltr">
              {cert.publicId}
            </p>
          </div>
          {order && order.status !== "cancelled" ? (
            <p className="text-[11px] font-medium text-muted-foreground">
              {ORDER_LABEL[order.status] ?? order.status}
              {order.trackingCode ? ` · کد پیگیری ${order.trackingCode}` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" className="h-8 flex-1" onClick={openCert}>
              <ExternalLink className="h-3.5 w-3.5" />
              مشاهده
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void copyLink()}>
              <Copy className="h-3.5 w-3.5" />
              کپی لینک
            </Button>
            {physicalOpen ? (
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={openCert}>
                <Package className="h-3.5 w-3.5" />
                فیزیکی
              </Button>
            ) : null}
          </div>
        </div>
      ) : eligible ? (
        <div className="space-y-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            دوره را تمام کرده‌اید. گواهینامه دیجیتال آمادهٔ صدور است.
          </p>
          <Button type="button" size="sm" className="h-8 w-full" disabled={issuing} onClick={() => void claim()}>
            {issuing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />}
            دریافت گواهینامه
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5",
          )}
        >
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-[11px] font-bold text-foreground">هنوز صادر نشده</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              با پاس کردن همه درس‌های فعال، گواهینامه همین‌جا نمایش داده می‌شود
              {physical?.enabled
                ? `؛ در صورت فعال بودن، نسخه فیزیکی (پرداخت آفلاین) تا ${formatFaNumber(physical.windowDays)} روز پس از صدور قابل درخواست است.`
                : "."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
