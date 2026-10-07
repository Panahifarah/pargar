"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { RegisterForm } from "@/components/register-form";
import { http } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["auth", "register-status"],
    queryFn: () => http.get<{ enabled: boolean }>("/api/auth/register-status"),
  });

  if (statusLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status?.enabled) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <BrandMark locale="fa" size="lg" logoOnly className="mx-auto mb-4" />
          <h1 className="text-xl font-bold">ثبت‌نام عمومی بسته است</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            در حال حاضر امکان ساخت حساب از این صفحه وجود ندارد. اگر حساب دارید وارد شوید،
            یا منتظر اعلام متصدی بمانید.
          </p>
          <Button asChild className="mt-6 w-full" variant="gradient">
            <Link href="/login">ورود به حساب</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-4xl flex-col justify-center px-4 py-8">
      <div className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-soft md:grid-cols-2">
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-7 text-primary-foreground md:flex">
          <div
            className="dot-grid pointer-events-none absolute -end-20 -top-20 h-72 w-72 rotate-12 text-primary-foreground opacity-50"
            aria-hidden
          />
          <div className="relative">
            <BrandMark locale="fa" size="lg" className="text-primary-foreground [&_span]:text-accent" />
            <p className="section-kicker on-primary mt-5">ثبت‌نام</p>
            <h2 className="mt-3 text-2xl font-bold leading-snug">
              یک حساب.
              <br />
              یک مسیر.
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-primary-foreground/80">
              شماره تلفن شما یک‌بار مصرف است — هر شبکه فقط یک ثبت‌نام.
            </p>
          </div>
          <p className="relative text-xs text-primary-foreground/70">
            پس از ثبت‌نام، پیامک را خودتان برای تیم ارسال کنید؛ سامانه پیامک خودکار ندارد.
          </p>
        </aside>

        <div className="bg-card p-6 sm:p-8">
          <CardHeader className="items-center space-y-1.5 px-0 pb-4 pt-0 text-center">
            <div className="mb-1 flex justify-center md:hidden">
              <BrandMark locale="fa" size="lg" logoOnly />
            </div>
            <CardTitle className="text-2xl">ساخت حساب</CardTitle>
            <CardDescription>در سه گام کوتاه حساب بسازید.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            <RegisterForm endpoint="/api/auth/register" submitLabel="ثبت‌نام" />
          </CardContent>
        </div>
      </div>
    </div>
  );
}
