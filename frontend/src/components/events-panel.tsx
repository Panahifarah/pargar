"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, Check, ExternalLink, Flame, MapPin, Users } from "lucide-react";
import { api, http, toUserError } from "@/lib/api";
import type { MeetingEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/panel";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { toast } from "@/components/providers";

export function EventsPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["events"],
    queryFn: () => http.get<{ events: MeetingEvent[] }>("/api/events"),
  });

  const toggle = useMutation({
    mutationFn: async (e: MeetingEvent) => {
      if (e.rsvped) {
        await api(`/api/events/${e.id}/rsvp`, { method: "DELETE" });
      } else {
        await api(`/api/events/${e.id}/rsvp`, { method: "POST" });
      }
    },
    onSuccess: (_d, e) => {
      toast.success(e.rsvped ? "ثبت‌نام لغو شد" : `در «${e.title}» ثبت‌نام شدید`);
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(toUserError(err, "به‌روزرسانی ثبت‌نام ممکن نشد")),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-4 rounded-2xl border-2 border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-40" />
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-7 w-7 rounded-full" />
              </div>
              <Skeleton className="h-9 w-28 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-medium text-destructive">{toUserError(error)}</p>
        <Button className="mt-3" variant="outline" onClick={() => refetch()}>
          تلاش دوباره
        </Button>
      </div>
    );
  }

  const events = data?.events ?? [];
  const past = events.filter((e) => new Date(e.endsAt).getTime() < Date.now());
  const upcoming = events.filter((e) => new Date(e.endsAt).getTime() >= Date.now());

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("fa-IR", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <Panel
      title="رویدادهای زنده"
      description="پیش‌روها را ثبت‌نام کنید و لینک پیوستن را همان‌جا بیابید."
      icon={<CalendarDays className="h-5 w-5" />}
      tint="bg-primary/10 text-primary"
      className="space-y-0"
    >
      <div className="space-y-8">
        {events.length === 0 && (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="هنوز رویدادی برنامه‌ریزی نشده"
            description="به‌زودی دوباره سر بزنید — یا از یک منتور بخواهید رویدادی برگزار کند."
          />
        )}

        {upcoming.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
              </span>
              <p className="text-xs font-bold text-foreground">پیش‌رو</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {upcoming.map((e) => (
                <Card key={e.id} className={cn("group relative overflow-hidden", e.rsvped && "ring-1 ring-primary/50")}>
                  <div className={cn("absolute inset-x-0 top-0 h-1 bg-primary", !e.rsvped && "bg-muted")} />
                  <CardContent className="pt-5">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="accent" className="rounded-lg">
                        {eventTypeLabel(e.eventType)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{fmt(e.startsAt)}</span>
                    </div>
                    <h3 className="text-lg font-bold leading-snug">{e.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.description}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {e.externalUrl && (
                        <a
                          href={e.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> پیوستن
                        </a>
                      )}
                      <button
                        className="inline-flex items-center gap-1 hover:underline"
                        onClick={() => window.open(`/api/events/${e.id}/ics`)}
                      >
                        <CalendarPlus className="h-3.5 w-3.5" /> افزودن به تقویم
                      </button>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button
                        size="sm"
                        variant={e.rsvped ? "outline" : "gradient"}
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(e)}
                      >
                        {e.rsvped ? (
                          <>
                            <Check className="h-4 w-4" /> شرکت می‌کنم
                          </>
                        ) : (
                          <>
                            <Users className="h-4 w-4" /> ثبت‌نام
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {past.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                <Flame className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <p className="text-xs font-bold text-muted-foreground">گذشته</p>
            </div>
            <div className="space-y-2">
              {past.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm opacity-80"
                >
                  <div>
                    <p className="font-medium">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{fmt(e.startsAt)}</p>
                  </div>
                  <Badge variant="outline" className="rounded-lg">{eventTypeLabel(e.eventType)}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> همه رویدادها آنلاین هستند — لینک پیوستن در هر کارت است.
        </p>
      </div>
    </Panel>
  );
}

function eventTypeLabel(eventType: string): string {
  if (eventType === "workshop") return "کارگاه";
  if (eventType === "meet") return "جلسه";
  if (eventType === "zoom") return "آنلاین";
  return eventType;
}