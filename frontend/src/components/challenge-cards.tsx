"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Trophy } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, formatFaNumber } from "@/lib/utils";

export type ChallengeView = {
  id: number;
  title: string;
  description: string;
  targetXp: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  myXp: number;
  completed: boolean;
};

export function ChallengeCards({ className }: { className?: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["challenges"],
    queryFn: () => http.get<{ challenges: ChallengeView[] }>("/api/challenges"),
  });

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn("rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm", className)}>
        <p className="font-medium text-destructive">{toUserError(error)}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
          تلاش دوباره
        </Button>
      </div>
    );
  }

  const list = data?.challenges ?? [];
  if (list.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {list.map((c) => {
        const pct = Math.min(100, Math.round((c.myXp / Math.max(c.targetXp, 1)) * 100));
        return (
          <div
            key={c.id}
            className={cn(
              "rounded-xl border-2 border-border bg-card p-4 shadow-soft",
              c.completed && "border-success/40 bg-success/5"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
                {c.completed ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Trophy className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{c.title}</p>
                {c.description && <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>}
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span>
                      {formatFaNumber(c.myXp)} / {formatFaNumber(c.targetXp)} امتیاز
                    </span>
                    <span className={c.completed ? "text-success" : "text-muted-foreground"}>
                      {c.completed ? "تکمیل شد" : `${formatFaNumber(pct)}٪`}
                    </span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  تا{" "}
                  {new Date(c.endsAt).toLocaleString("fa-IR", {
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
