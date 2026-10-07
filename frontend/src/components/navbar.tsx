"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Flame, Heart, LogOut, Sparkles, User, UserCog } from "lucide-react";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import { useRealtimeGateway } from "@/hooks/use-realtime";
import { useLiveUser } from "@/hooks/use-live-user";
import { useAuth } from "@/lib/auth-store";
import { http } from "@/lib/api";
import { heartsOf, hasInfiniteHearts, MAX_HEARTS, INFINITE_HEARTS_LABEL } from "@/lib/hearts";
import { useState } from "react";
import { AvatarStudio } from "@/components/avatar-studio";
import { UserAvatar, avatarPaletteOf } from "@/components/ui/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn, formatFaNumber } from "@/lib/utils";

const navLinks = [
  { href: "/cap", label: "درخت مهارت" },
  { href: "/unwrap", label: "مرکز" },
  { href: "/leaderboard", label: "لیگ‌ها" },
];

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuth((s) => s.user);
  const liveUser = useLiveUser();
  useRealtimeGateway();
  const [studioOpen, setStudioOpen] = useState(false);

  const locked = !!liveUser?.isLocked && !hasInfiniteHearts(liveUser.role);
  const infiniteHearts = hasInfiniteHearts(liveUser?.role);
  const effHearts = heartsOf(liveUser);

  const logout = () => {
    const { refreshToken, clear: clearAuth } = useAuth.getState();
    void http.post("/api/auth/logout", refreshToken ? { refreshToken } : {}).catch(() => undefined);
    clearAuth();
    router.replace("/");
  };

  // Guest chrome: home + login only
  if (!user) {
    return (
      <header className="nav-glass sticky top-0 z-40 w-full border-b-2 border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="group flex items-center gap-2.5 transition-transform duration-200 group-hover:-translate-y-0.5">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {pathname !== "/login" && (
              <Button asChild size="sm" className="font-bold">
                <Link href="/login">ورود</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="nav-glass sticky top-0 z-40 w-full border-b-2 border-border/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/cap" className="group flex items-center gap-2.5 transition-transform duration-200 group-hover:-translate-y-0.5">
            <BrandMark />
          </Link>
          {!locked && (
            <nav className="ms-4 hidden items-center gap-1 md:flex">
              {navLinks.map((l) => {
                const active = pathname === l.href || pathname.startsWith(l.href + "/");
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn(
                      "press rounded-lg px-3.5 py-2 text-sm font-bold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-offset-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {liveUser && (
            <>
              <div className="hidden items-center gap-1.5 sm:flex">
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent transition-transform hover:-translate-y-0.5">
                  <Flame className="h-3.5 w-3.5" />
                  {formatFaNumber(liveUser.streakCurrent)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2.5 py-1 text-xs font-bold text-gold transition-transform hover:-translate-y-0.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  {formatFaNumber(liveUser.xp)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold leading-none transition-transform hover:-translate-y-0.5",
                    locked
                      ? "bg-destructive/10 text-destructive"
                      : infiniteHearts
                        ? "bg-primary/10 text-primary"
                        : effHearts === 1
                          ? "bg-destructive/10 text-destructive animate-pulse-soft"
                          : "bg-primary/10 text-primary"
                  )}
                  title={
                    locked
                      ? "حساب محدود است — منتور باید قفل را باز کند"
                      : infiniteHearts
                        ? "جان نامحدود"
                        : `${formatFaNumber(effHearts)} از ${formatFaNumber(MAX_HEARTS)} جان`
                  }
                >
                  <Heart className={cn("h-3.5 w-3.5", (locked || (!infiniteHearts && effHearts <= 1)) && "fill-current")} />
                  {infiniteHearts ? (
                    <span className="text-sm leading-none">{INFINITE_HEARTS_LABEL}</span>
                  ) : (
                    <>
                      {formatFaNumber(effHearts)}/{formatFaNumber(MAX_HEARTS)}
                    </>
                  )}
                </span>
              </div>
              <NotificationBell />
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="cursor-pointer rounded-full ring-2 ring-border ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-ring"
                  >
                    <UserAvatar
                      name={liveUser.name ?? "؟"}
                      src={liveUser.avatarPhoto}
                      variant={liveUser.avatarVariant ?? "beam"}
                      palette={liveUser.avatarPalette ? avatarPaletteOf(liveUser.avatarPalette) : undefined}
                      className="h-9 w-9"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 shadow-offset-sm">
                  <div className="flex items-center gap-3 px-2.5 py-2.5">
                    <UserAvatar
                      name={liveUser.name ?? "؟"}
                      src={liveUser.avatarPhoto}
                      variant={liveUser.avatarVariant ?? "beam"}
                      palette={liveUser.avatarPalette ? avatarPaletteOf(liveUser.avatarPalette) : undefined}
                      className="h-11 w-11"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold">{liveUser.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{liveUser.email}</p>
                      <p className="text-[11px] text-primary">{roleLabel(liveUser.role)}</p>
                    </div>
                  </div>
                  <DropdownMenuItem onClick={() => router.push("/profile")}>
                    <User /> پروفایل من
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setStudioOpen(true)}>
                    <User /> ویرایش آواتار
                  </DropdownMenuItem>
                  {liveUser.role === "admin" && (
                    <DropdownMenuItem onClick={() => router.push("/admin")}>
                      <UserCog /> پنل مدیریت
                    </DropdownMenuItem>
                  )}
                  {liveUser.role === "mentor" && (
                    <DropdownMenuItem onClick={() => router.push("/admin")}>
                      <UserCog /> پنل منتور
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                    <LogOut /> خروج
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Dialog open={studioOpen} onOpenChange={setStudioOpen}>
                <DialogContent className="max-h-[85vh] max-w-sm gap-3 overflow-y-auto chat-scroll rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-center">ویرایش آواتار</DialogTitle>
                  </DialogHeader>
                  <AvatarStudio user={liveUser} onClose={() => setStudioOpen(false)} />
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function roleLabel(role: string): string {
  if (role === "admin") return "ادمین";
  if (role === "mentor") return "منتور";
  return "هنرجو";
}
