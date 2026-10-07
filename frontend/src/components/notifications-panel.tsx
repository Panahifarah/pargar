"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CheckCheck, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";
import { http } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

const categoryMap: Record<
  string,
  { label: string; dot: string; classes: string }
> = {
  progress: { label: "پیشرفت", dot: "bg-primary", classes: "bg-primary/10 text-primary" },
  gamification: { label: "بازی‌سازی", dot: "bg-gold", classes: "bg-gold/15 text-gold" },
  mentor: { label: "منتور", dot: "bg-accent", classes: "bg-accent/15 text-accent" },
  event: { label: "رویداد", dot: "bg-secondary", classes: "bg-secondary/15 text-secondary" },
};

export function NotificationsPanel() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => http.get<{ notifications: NotificationItem[]; unread: number }>("/api/notifications?limit=50"),
  });

  const markAll = useMutation({
    mutationFn: () => http.post("/api/notifications/read-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const notifications = data?.notifications ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data?.unread ? `${data.unread} خوانده‌نشده` : "همه‌چیز به‌روز است"} · {notifications.length} اعلان اخیر
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => markAll.mutate()} disabled={!data?.unread}>
          <CheckCheck className="h-4 w-4" /> خواندن همه
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2 py-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && notifications.length === 0 && (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="هنوز اعلانی نیست"
          description="پیشرفت، زنجیرهٔ فعالیت، یادآوری ثبت‌نام و پاسخ منتور اینجا می‌آیند."
        />
      )}

      <div className="space-y-2">
        {notifications.map((n) => {
          const cat = categoryMap[n.category] ?? { label: n.category, dot: "bg-primary", classes: "bg-muted text-muted-foreground" };
          return (
            <button
              key={n.id}
              onClick={() => {
                if (n.route) router.push(n.route);
              }}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-right transition-colors hover:border-primary/30 hover:bg-muted/40",
                !n.readAt ? "border-primary/30 bg-primary/5" : "border-border bg-card"
              )}
            >
              <span className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", cat.dot)} />
              <span className="flex-1 space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.title}</span>
                  <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] rounded-lg", cat.classes)}>
                    {cat.label}
                  </Badge>
                </span>
                {n.body && <span className="block text-sm text-muted-foreground">{n.body}</span>}
                <span className="block text-[11px] text-muted-foreground/70">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: faIR })}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}