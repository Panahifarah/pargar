"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Lock, MessageSquare, Send, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { api, http, toUserError } from "@/lib/api";
import { MAX_HEARTS, clampHearts, hasInfiniteHearts } from "@/lib/hearts";
import type { Mentor, User } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/providers";
import { cn } from "@/lib/utils";

export default function LockoutPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const [mentorId, setMentorId] = useState<number | null>(null);

  const syncUser = useCallback(async () => {
    try {
      const res = await api<{ user: User }>("/api/auth/me");
      useAuth.getState().setUser(res.user);
      if (!res.user.isLocked || hasInfiniteHearts(res.user.role)) {
        router.replace("/cap");
      }
    } catch {
      /* ignore */
    }
  }, [router]);

  useEffect(() => {
    if (user && (!user.isLocked || hasInfiniteHearts(user.role))) {
      router.replace("/cap");
      return;
    }
    const onFocus = () => void syncUser();
    window.addEventListener("focus", onFocus);
    void syncUser();
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [syncUser, user, router]);

  useEffect(() => {
    void http
      .get<{ mentors: Mentor[] }>("/api/mentors")
      .then((r) => {
        const first = r.mentors?.[0];
        if (first) setMentorId(first.id);
      })
      .catch(() => undefined);
  }, []);

  const requestUnlock = async () => {
    setBusy(true);
    try {
      const res = await http.post<{ message?: string }>("/api/me/request-unlock", { note });
      setRequested(true);
      toast.success(res.message || "درخواست ثبت شد");
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(false);
    }
  };

  const openMentorChat = () => {
    const draft =
      "سلام، حسابم بعد از اتمام جان‌ها قفل شده. لطفاً برای رفع محدودیت راهنمایی‌ام کنید.";
    window.dispatchEvent(
      new CustomEvent("pargar:chat", {
        detail: { open: true, with: mentorId ?? undefined, draft },
      }),
    );
  };

  const hearts = clampHearts(user?.hearts ?? 0);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive/15">
        <Lock className="h-11 w-11 text-destructive" />
      </div>

      <p className="text-xs font-bold tracking-wider text-destructive">حساب قفل شد</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">جان‌هایتان تمام شد</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        هر پاسخ اشتباه در آزمون یک جان کم می‌کند. با تمام شدن سه جان، یادگیری و آزمون قفل می‌شود تا
        تیم مسیر را بررسی کند — خودتان نمی‌توانید قفل را باز کنید.
      </p>

      <div className="mt-6 flex items-center gap-2">
        {Array.from({ length: MAX_HEARTS }).map((_, i) =>
          i < hearts ? (
            <span key={i} className="grid h-9 w-9 place-items-center rounded-full bg-destructive/15 text-destructive">
              <Heart className="h-5 w-5 fill-current" />
            </span>
          ) : (
            <span key={i} className="grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground/40">
              <Heart className="h-5 w-5" />
            </span>
          ),
        )}
      </div>

      <Card className="mt-6 w-full space-y-3 border-destructive/30 bg-destructive/5 p-4 text-start text-sm text-muted-foreground">
        <p className="font-bold text-foreground">گام بعدی</p>
        <ol className="list-decimal space-y-1.5 pe-4 text-xs leading-relaxed">
          <li>از طریق گفتگو با منتور وضعیت را توضیح دهید.</li>
          <li>درخواست بررسی را برای تیم ثبت کنید (حداکثر یک‌بار در ۱۲ ساعت).</li>
          <li>بعد از تأیید متصدی، ۳ جان برمی‌گردد و مسیر دوباره باز می‌شود.</li>
        </ol>
      </Card>

      <div className="mt-5 w-full space-y-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={3}
          dir="rtl"
          placeholder="اختیاری: چه آزمونی گیر کردید؟ چه کمکی لازم دارید؟"
          className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-primary/50"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" disabled={busy || requested} onClick={() => void requestUnlock()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {requested ? "درخواست ارسال شد" : "درخواست رفع قفل"}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={openMentorChat}
          >
            <MessageSquare className="h-4 w-4" /> گفتگو با منتور
          </Button>
        </div>
        <Button
          variant="ghost"
          className={cn("w-full text-muted-foreground")}
          onClick={() => router.push("/unwrap?tab=community")}
        >
          جامعه و حمایت
        </Button>
      </div>
    </div>
  );
}
