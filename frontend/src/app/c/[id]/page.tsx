"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Loader2, Package } from "lucide-react";
import { CertificateCard } from "@/components/certificate-card";
import { NotFoundState, notFoundSentence } from "@/components/not-found-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, toUserError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import type { Certificate, CertificatePhysicalOrder, PhysicalCertSettings } from "@/lib/types";
import { toast } from "@/components/providers";
import { formatFaNumber } from "@/lib/utils";
import { clampPhoneInput, normalizePhone, PHONE_INPUT_MAX_LEN } from "@/lib/validation";
import { useEffect, useState } from "react";

type PublicCertResponse = {
  certificate: { publicId: string; fullName: string; issuedAt: string };
  course: string;
};

const STATUS_LABEL: Record<string, string> = {
  requested: "درخواست‌شده — منتظر تأیید پرداخت",
  paid: "پرداخت تأیید شد — در صف ارسال",
  shipped: "ارسال شد",
  cancelled: "لغو شده",
};

export default function CertificatePage() {
  const params = useParams<{ id: string }>();
  const publicId = params?.id ?? "";
  const authUser = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [requesting, setRequesting] = useState(false);
  const [form, setForm] = useState({
    recipientName: "",
    phone: "",
    address: "",
    city: "",
    postalCode: "",
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["certificate", publicId],
    queryFn: () => http.get<PublicCertResponse>(`/api/certificates/${publicId}`),
    enabled: !!publicId,
    meta: { silentError: true },
  });

  const { data: mine } = useQuery({
    queryKey: ["me", "certificate"],
    queryFn: () =>
      http.get<{
        certificate: Certificate | null;
        physicalOrder: CertificatePhysicalOrder | null;
        physical: PhysicalCertSettings;
      }>("/api/me/certificate"),
    enabled: !!authUser,
  });

  const isOwner = !!authUser && mine?.certificate?.publicId === publicId;

  useEffect(() => {
    if (!isOwner || !authUser) return;
    setForm((f) => ({
      ...f,
      recipientName: f.recipientName || authUser.name || "",
      phone: f.phone || authUser.phone || "",
    }));
  }, [isOwner, authUser]);

  const requestPhysical = async () => {
    setRequesting(true);
    try {
      await http.post("/api/me/certificate/physical", {
        ...form,
        phone: normalizePhone(form.phone),
      });
      toast.success("درخواست ثبت شد — پس از واریز با ادمین هماهنگ کنید");
      qc.invalidateQueries({ queryKey: ["me", "certificate"] });
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setRequesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.certificate) {
    return (
      <NotFoundState
        title="گواهینامه پیدا نشد"
        description={notFoundSentence(
          error ? toUserError(error, "") : "",
          "این گواهینامه در سامانه نیست.",
          "گواهینامه پیدا نشد",
        )}
        href="/"
        actionLabel="بازگشت به خانه"
      />
    );
  }

  const cert = data.certificate;
  const order = isOwner ? mine?.physicalOrder : null;
  const physical = isOwner ? mine?.physical : null;
  const windowEndsAt = mine?.certificate?.issuedAt
    ? new Date(mine.certificate.issuedAt).getTime() + (physical?.windowDays ?? 30) * 86400000
    : 0;
  const windowStillOpen = !windowEndsAt || Date.now() < windowEndsAt;
  const windowOpen =
    physical?.enabled &&
    windowStillOpen &&
    (!order || order.status === "cancelled") &&
    !!mine?.certificate;

  return (
    <CertificateCard
      cert={{
        publicId: cert.publicId,
        fullName: cert.fullName,
        issuedAt: cert.issuedAt,
        course: data.course,
      }}
      showOwnerLinks={!!authUser}
    >
      {isOwner && physical?.enabled && (
        <div className="mt-8 space-y-3 border-t border-border pt-6">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Package className="h-4 w-4" /> نسخه فیزیکی
          </p>
          <p className="text-xs text-muted-foreground">
            قیمت حدودی {formatFaNumber(physical.priceIrr)} ریال · مهلت درخواست{" "}
            {formatFaNumber(physical.windowDays)} روز از صدور
            {windowEndsAt ? ` (تا ${new Date(windowEndsAt).toLocaleDateString("fa-IR")})` : ""}.
            پرداخت آنلاین در سامانه نداریم. پس از واریز بیرونی با ادمین هماهنگ کنید تا وضعیت سفارش به‌روز شود.
          </p>
          {order && order.status !== "cancelled" ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p>
                وضعیت: <span className="font-medium">{STATUS_LABEL[order.status] ?? order.status}</span>
              </p>
              {order.trackingCode && (
                <p className="font-mono text-xs" dir="ltr">
                  کد پیگیری: {order.trackingCode}
                </p>
              )}
              {order.city && (
                <p className="text-xs text-muted-foreground">
                  ارسال به {order.recipientName || "—"} · {order.city}
                </p>
              )}
              {order.note && <p className="text-xs text-muted-foreground">یادداشت ادمین: {order.note}</p>}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("pargar:chat", { detail: { open: true } }))
                }
              >
                هماهنگی با تیم
              </Button>
            </div>
          ) : windowOpen ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="نام گیرنده"
                  value={form.recipientName}
                  onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                />
                <Input
                  placeholder="موبایل"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: clampPhoneInput(e.target.value) }))}
                  dir="ltr"
                  inputMode="tel"
                  maxLength={PHONE_INPUT_MAX_LEN}
                  className="text-left"
                />
                <Input
                  placeholder="شهر"
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                />
                <Input
                  placeholder="کد پستی"
                  value={form.postalCode}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <textarea
                className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="آدرس کامل پستی"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
              <Button
                size="sm"
                disabled={requesting || !form.address.trim() || !form.city.trim()}
                onClick={() => void requestPhysical()}
              >
                {requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                ثبت درخواست نسخه فیزیکی
              </Button>
            </div>
          ) : !windowStillOpen ? (
            <p className="text-sm text-muted-foreground">مهلت درخواست نسخه فیزیکی به پایان رسیده است.</p>
          ) : null}
        </div>
      )}
    </CertificateCard>
  );
}
