"use client";

import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { useAuth, useAuthHydrated } from "@/lib/auth-store";
import { Home, LogIn, Trees } from "lucide-react";

export default function NotFound() {
  const hydrated = useAuthHydrated();
  const user = useAuth((s) => s.user);
  const loggedIn = hydrated && !!user;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div className="relative w-full overflow-hidden rounded-2xl border-2 border-border bg-card px-8 py-14 shadow-offset">
        <div className="dot-grid dot-grid-primary pointer-events-none absolute -end-10 -top-10 h-40 w-40 opacity-60" aria-hidden />
        <p className="text-7xl font-black tabular-nums text-primary/25">۴۰۴</p>
        <div className="mt-4 flex justify-center">
          <BrandMark locale="fa" size="lg" />
        </div>
        <h1 className="mt-6 text-2xl font-black tracking-tight">این مسیر پیدا نشد</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {loggedIn
            ? "این آدرس در سامانه نیست. از درخت مهارت یا مرکز ادامه دهید."
            : "صفحه‌ای که دنبالش بودید پیدا نشد. می‌توانید به خانه برگردید یا وارد حساب شوید."}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {loggedIn ? (
            <>
              <Button asChild className="gap-2">
                <Link href="/cap">
                  <Trees className="h-4 w-4" /> درخت مهارت
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link href="/unwrap?tab=community">مرکز · حمایت</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild className="gap-2">
                <Link href="/">
                  <Home className="h-4 w-4" /> خانه
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link href="/login">
                  <LogIn className="h-4 w-4" /> ورود
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
