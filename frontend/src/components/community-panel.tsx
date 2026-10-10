"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Share2 } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";

export type SocialLink = { name: string; url: string };

export type CommunityPayload = {
  socials: SocialLink[];
};

export function CommunityPanel() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["community"],
    queryFn: () => http.get<CommunityPayload>("/api/community"),
  });

  if (isLoading) {
    return <div className="h-72 animate-pulse rounded-2xl border-2 border-border bg-muted/40" />;
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-8 text-center">
        <p className="font-medium text-destructive">{toUserError(error)}</p>
        <Button className="mt-4" variant="outline" onClick={() => refetch()}>
          تلاش دوباره
        </Button>
      </div>
    );
  }

  const socials = data?.socials ?? [];

  return (
    <div className="mx-auto max-w-xl">
      <Panel
        title="شبکه‌های پرگار"
        description="راه‌های رسمی ارتباط با برنامه. لینک شخصی هر کاربر روی پروفایل خودش است."
        icon={<Share2 className="h-5 w-5" />}
        tint="bg-primary/15 text-primary"
      >
        {socials.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">هنوز شبکه‌ای ثبت نشده است.</p>
        ) : (
          <ul className="space-y-2 pt-1">
            {socials.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border-2 border-border/70 px-3 py-2.5 text-sm font-bold transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <span>{s.name}</span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
