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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { http } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { useRouter } from "next/navigation";

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

  const categoryDot: Record<string, string> = {
    progress: "bg-primary",
    gamification: "bg-gold",
    mentor: "bg-accent",
    event: "bg-secondary",
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
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between rounded-t-md border-b border-border bg-muted/40 px-3 py-2.5">
          <span className="text-sm font-semibold">اعلان‌ها</span>
          <div className="flex items-center gap-1">
            {unread > 0 && <Badge variant="destructive" className="px-2 py-0">{unread} جدید</Badge>}
            <Button variant="ghost" size="sm" onClick={markAll} className="h-7 gap-1 px-2 text-xs">
              <CheckCheck className="h-3.5 w-3.5" /> خواندن همه
            </Button>
          </div>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {isLoading && (
            <div className="space-y-3 px-3 py-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
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
          {data?.notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (n.route) router.push(n.route);
              }}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-right transition-colors hover:bg-muted/60",
                !n.readAt && "bg-primary/5"
              )}
            >
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", categoryDot[n.category] ?? "bg-primary")} />
              <span className="flex-1 space-y-0.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: faIR })}
                  </span>
                </span>
                {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => router.push("/notifications")}
          className="w-full rounded-b-md bg-muted/40 py-2.5 text-xs font-semibold text-primary hover:bg-muted"
        >
          مشاهده همه اعلان‌ها
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}