"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, Ticket } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { RegisterForm } from "@/components/register-form";
import { http, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type InviteStatus = {
  valid: boolean;
  label?: string;
};

export default function InviteRegisterPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const { data: invite, isLoading, error, isError } = useQuery({
    queryKey: ["auth", "register-invite", token],
    queryFn: () => http.get<InviteStatus>(`/api/auth/register-invite/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
    meta: { silentError: true },
  });

  const closedMessage = (() => {
    if (!isError) return null;
    if (error instanceof ApiError) return error.message;
    return "این لینک عضویت قابل استفاده نیست.";
  })();

  if (!token || isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (closedMessage || !invite?.valid) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <BrandMark locale="fa" size="lg" logoOnly className="mx-auto mb-4" />
          <h1 className="text-xl font-bold">لینک عضویت بسته است</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {closedMessage ?? "این لینک عضویت قابل استفاده نیست."}
          </p>
          <Button asChild className="mt-6 w-full" variant="gradient">
            <Link href="/login">ورود به حساب</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-4xl flex-col justify-center py-8">
      <div className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-soft md:grid-cols-2">
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-8 text-primary-foreground md:flex">
          <div
            className="dot-grid pointer-events-none absolute -end-20 -top-20 h-72 w-72 rotate-12 text-primary-foreground opacity-50"
            aria-hidden
          />
          <div className="relative">
            <BrandMark locale="fa" size="lg" className="text-primary-foreground [&_span]:text-accent" />
            <p className="section-kicker on-primary mt-6">عضویت با دعوت</p>
            <h2 className="mt-4 text-2xl font-bold leading-snug">
              {invite.label || "لینک اختصاصی"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-primary-foreground/80">
              با این دعوت می‌توانید حساب عضویت بسازید.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-primary-foreground/70">
              شماره تلفن و شبکه شما فقط یک‌بار برای ثبت‌نام قابل استفاده‌اند.
            </p>
          </div>
          <p className="relative flex items-center gap-2 text-xs text-primary-foreground/70">
            <Ticket className="h-3.5 w-3.5" />
            پس از ثبت‌نام، پیامک را خودتان برای تیم ارسال کنید؛ سامانه پیامک خودکار ندارد.
          </p>
        </aside>

        <div className="bg-card p-8 sm:p-10">
          <CardHeader className="items-center px-0 pb-4 pt-0 text-center">
            <div className="mb-2 flex justify-center md:hidden">
              <BrandMark locale="fa" size="lg" logoOnly />
            </div>
            <CardTitle className="text-2xl">ساخت حساب با دعوت</CardTitle>
            <CardDescription>
              {invite.label ? invite.label : "فرم ثبت‌نام با لینک دعوت"}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            <RegisterForm
              endpoint={`/api/auth/register-invite/${encodeURIComponent(token)}`}
              submitLabel="ثبت‌نام با دعوت"
            />
          </CardContent>
        </div>
      </div>
    </div>
  );
}
