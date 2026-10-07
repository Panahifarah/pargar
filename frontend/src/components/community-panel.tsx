"use client";

import { useQuery } from "@tanstack/react-query";
import { HeartHandshake, LogIn, MessageSquareHeart } from "lucide-react";
import Link from "next/link";
import { http, toUserError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";

export type CommunityPayload = {
  donation: {
    enabled: boolean;
    note: string;
    mode: "chat";
    contactId?: number;
    draft: string;
  };
};

function openDonationChat(contactId: number | undefined, draft: string) {
  window.dispatchEvent(
    new CustomEvent("pargar:chat", {
      detail: { open: true, with: contactId, draft },
    }),
  );
}

export function CommunityPanel() {
  const user = useAuth((s) => s.user);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["community", user?.id ?? "guest"],
    queryFn: () => http.get<CommunityPayload>("/api/community"),
  });

  if (isLoading) {
    return (
      <div className="h-72 animate-pulse rounded-2xl border-2 border-border bg-muted/40" />
    );
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

  const donation = data?.donation;

  return (
    <div className="mx-auto max-w-xl">
      <Panel
        title="حمایت مالی"
        description="بدون کارت عمومی — اگر لاگین باشید، گفتگو با تیم باز می‌شود."
        icon={<HeartHandshake className="h-5 w-5" />}
        tint="bg-accent/15 text-accent"
      >
        {donation?.enabled ? (
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-relaxed text-muted-foreground">{donation.note}</p>
            <div className="rounded-2xl border border-border bg-muted/20 p-5 text-sm leading-relaxed">
              جزئیات واریز فقط در پیام خصوصی رد و بدل می‌شود؛ اینجا چیزی عمومی نیست.
            </div>
            {user ? (
              <Button
                className="w-full gap-2"
                size="lg"
                onClick={() => openDonationChat(donation.contactId, donation.draft)}
              >
                <MessageSquareHeart className="h-4 w-4" /> پیام دربارهٔ دونیت
              </Button>
            ) : (
              <Button asChild className="w-full gap-2" size="lg">
                <Link href="/login">
                  <LogIn className="h-4 w-4" /> ورود برای هماهنگی دونیت
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">حمایت فعلاً غیرفعال است.</p>
        )}
      </Panel>
    </div>
  );
}
