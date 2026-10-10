"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { http } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { useRouter } from "next/navigation";
import { SafeMarkdown } from "@/components/safe-markdown";

export function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => http.get<{ notifications: NotificationItem[]; unread: number }>("/api/notifications?limit=12"),
  });
  const unread = data?.unread ?? 0;

  const markAll = async () => {
    await http.post("/api/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  const categoryMeta: Record<string, { label: string; dot: string }> = {
    progress: { label: "پیشرفت", dot: "bg-primary" },
    gamification: { label: "بازی‌سازی", dot: "bg-gold" },
    mentor: { label: "منتور", dot: "bg-accent" },
    event: { label: "رویداد", dot: "bg-secondary" },
    urgent: { label: "فوری", dot: "bg-destructive" },
    curriculum: { label: "درس", dot: "bg-primary" },
    community: { label: "جامعه", dot: "bg-accent" },
    system: { label: "سیستم", dot: "bg-muted-foreground" },
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-md" aria-label="اعلان‌ها">
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        collisionPadding={12}
        className="w-[min(22rem,calc(100vw-1.25rem))] overflow-hidden p-0"
      >
        <div dir="rtl" className="text-start">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">اعلان‌ها</p>
              <p className="text-[11px] text-muted-foreground">
                {unread > 0 ? `${unread} خوانده‌نشده` : "همه خوانده شده"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={markAll}
              disabled={unread === 0}
              className="h-8 w-8 shrink-0"
              aria-label="خواندن همه"
              title="خواندن همه"
            >
              <CheckCheck className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-[min(22rem,calc(100vh-8rem))] overflow-y-auto">
            {isLoading && (
              <div className="space-y-3 px-3 py-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                ))}
              </div>
            )}
            {!isLoading && (!data?.notifications || data.notifications.length === 0) && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                اعلانی ندارید.
                <br />
                <span className="text-xs">با قبولی در یک آزمون یا ثبت‌نام در رویداد، اعلان می‌گیرید.</span>
              </div>
            )}
            {data?.notifications.map((n) => {
              const cat = categoryMeta[n.category] ?? { label: "اعلان", dot: "bg-primary" };
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (n.route) router.push(n.route);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-start transition-colors last:border-b-0 hover:bg-muted/60",
                    !n.readAt && "bg-primary/[0.06]",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-border" : cat.dot)} />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-sm font-medium [unicode-bidi:plaintext]">
                      {n.title}
                    </span>
                    {n.body && <SafeMarkdown text={n.body} lines={2} className="mt-0.5 text-xs text-muted-foreground" />}
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>{cat.label}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: faIR })}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => router.push("/notifications")}
            className="w-full border-t border-border bg-muted/40 py-2.5 text-xs font-semibold text-primary hover:bg-muted"
          >
            مشاهده همه اعلان‌ها
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}