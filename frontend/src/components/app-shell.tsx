"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ChatWidget } from "@/components/mentor-chat";
import { BrandMark } from "@/components/brand-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth, useAuthHydrated } from "@/lib/auth-store";
import { http } from "@/lib/api";
import type { User } from "@/lib/types";
import { hasInfiniteHearts } from "@/lib/hearts";

function isPublic(p: string) {
  return p === "/" || p === "/login";
}

const PROTECTED_PREFIXES = [
  "/cap",
  "/unwrap",
  "/leaderboard",
  "/admin",
  "/player",
  "/quiz",
  "/notifications",
  "/lockout",
  "/profile",
];

function needsAuth(p: string) {
  if (isPublic(p)) return false;
  return PROTECTED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useAuthHydrated();
  const { user, setUser, accessToken, clear } = useAuth();
  const [bootDone, setBootDone] = useState(false);

  // Wait for persist hydration, then optionally refresh /me
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const boot = async () => {
      if (!accessToken) {
        if (!cancelled) setBootDone(true);
        return;
      }
      try {
        const { user: me } = await http.get<{ user: User }>("/api/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) setBootDone(true);
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [hydrated, accessToken, clear, setUser]);

  const ready = hydrated && bootDone;
  const requiresAuth = needsAuth(pathname);

  // Redirects only in effects — never during render
  useEffect(() => {
    if (!ready) return;
    if (!user && requiresAuth) {
      router.replace("/login");
      return;
    }
    if (user && pathname === "/login") {
      router.replace("/cap");
      return;
    }
    if (
      user?.isLocked &&
      !hasInfiniteHearts(user.role) &&
      pathname !== "/lockout" &&
      pathname !== "/unwrap" &&
      requiresAuth
    ) {
      router.replace("/lockout");
    }
  }, [ready, user, requiresAuth, pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col">
        <div aria-hidden className="h-1 w-full bg-gradient-to-l from-primary via-accent to-gold" />
        <div className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-3.5 w-28" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-24 rounded-xl" />
            </div>
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
          <div className="space-y-6">
            <Skeleton className="h-8 w-56" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-2xl" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Protected routes: never mount children when logged out. Unknown URLs (404) stay visible.
  const allowChildren = !requiresAuth || !!user;
  const showLockBanner = !!user?.isLocked && !hasInfiniteHearts(user.role) && pathname !== "/lockout";

  return (
    <div className="flex min-h-screen flex-col">
      <div aria-hidden className="h-1 w-full bg-gradient-to-l from-primary via-accent to-gold" />
      <Navbar />
      {showLockBanner && (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm font-medium text-destructive">
          حساب شما قفل شده است — رفع محدودیت فقط با بررسی مدیریت انجام می‌شود.
          <button
            type="button"
            className="underline underline-offset-2 hover:text-destructive/80"
            onClick={() => router.push("/lockout")}
          >
            صفحه قفل
          </button>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {allowChildren ? children : null}
      </main>
      <footer className="border-t border-border/70 bg-muted/20 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 sm:flex-row sm:px-6">
          <BrandMark size="sm" logoOnly />
          <p className="text-xs text-muted-foreground">
            بوت‌کمپ ۱۲ هفته‌ای · توسعه‌یافته توسط امیرحسین پناهی‌فر
          </p>
        </div>
      </footer>
      {user && <ChatWidget />}
    </div>
  );
}
