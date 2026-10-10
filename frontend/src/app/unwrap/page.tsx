"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Award, CalendarDays, MessageSquareHeart, Share2, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EventsPanel } from "@/components/events-panel";
import { LeaderboardPanel } from "@/components/leaderboard-panel";
import { CommunityPanel } from "@/components/community-panel";
import { Button } from "@/components/ui/button";
import { UserAvatar, avatarPropsOf } from "@/components/ui/user-avatar";
import { Skeleton, SkeletonAvatar } from "@/components/ui/skeleton";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import type { Mentor } from "@/lib/types";
import { http } from "@/lib/api";
import type { ChatMessage, Conversation } from "@/lib/types";
import { cn, formatJalaliStamp } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import { isVerifiedRole, VerifiedBadge } from "@/components/verified-badge";

type Tab = "events" | "chats" | "leagues" | "community";

const TABS: Tab[] = ["events", "chats", "leagues", "community"];

function parseTab(raw: string | null): Tab {
  if (raw && (TABS as string[]).includes(raw)) {
    return raw as Tab;
  }
  return "events";
}

export default function UnwrapPage() {
  return (
    <Suspense fallback={null}>
      <HubTabs />
    </Suspense>
  );
}

function HubTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get("tab")));

  useEffect(() => {
    const raw = params.get("tab");
    const next = parseTab(raw);
    setTab(next);
    // Invalid / unknown ?tab=… → clean URL so content isn't blank.
    if (raw != null && raw !== next) {
      router.replace(next === "events" ? "/unwrap" : `/unwrap?tab=${next}`, { scroll: false });
    }
  }, [params, router]);

  const onTab = (value: string) => {
    const next = parseTab(value);
    setTab(next);
    const url = next === "events" ? "/unwrap" : `/unwrap?tab=${next}`;
    router.replace(url, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="مرکز"
        title={
          <>
            جامعه، <span className="text-gradient-brand">استمرار و منتورها</span>
          </>
        }
        description="رویدادهای زنده برای تقویت مهارت، لیگ‌های هفتگی برای ثبات، گفتگو، و شبکه‌های پرگار."
        className="mb-0"
      />

      <Tabs value={tab} onValueChange={onTab} className="w-full space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1.5 sm:grid-cols-4">
          <TabsTrigger value="events" className="h-10 gap-1.5 px-2 sm:px-3">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span className="truncate">رویدادها</span>
          </TabsTrigger>
          <TabsTrigger value="chats" className="h-10 gap-1.5 px-2 sm:px-3">
            <MessageSquareHeart className="h-4 w-4 shrink-0" />
            <span className="truncate">گفتگو با منتور</span>
          </TabsTrigger>
          <TabsTrigger value="leagues" className="h-10 gap-1.5 px-2 sm:px-3">
            <Award className="h-4 w-4 shrink-0" />
            <span className="truncate">لیگ‌ها</span>
          </TabsTrigger>
          <TabsTrigger value="community" className="h-10 gap-1.5 px-2 sm:px-3">
            <Share2 className="h-4 w-4 shrink-0" />
            <span className="truncate">شبکه‌ها</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="mt-0 space-y-4">
          <EventsPanel />
        </TabsContent>
        <TabsContent value="chats" className="mt-0">
          <ChatsLauncher />
        </TabsContent>
        <TabsContent value="leagues" className="mt-0">
          <LeaderboardPanel />
        </TabsContent>
        <TabsContent value="community" className="mt-0">
          <CommunityPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function openChat(withId?: number) {
  window.dispatchEvent(new CustomEvent("pargar:chat", { detail: { open: true, with: withId } }));
}

function roleWord(role?: string) {
  if (role === "admin") return "مدیر";
  if (role === "mentor") return "منتور";
  if (role === "student") return "هنرجو";
  return "کاربر";
}

function ChatsLauncher() {
  const me = useAuth((s) => s.user);
  const staff = me?.role === "admin" || me?.role === "mentor";
  const [peoplePage, setPeoplePage] = useState(1);
  const [alpha, setAlpha] = useState(false);
  const [convPage, setConvPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["mentors", peoplePage],
    queryFn: () => http.get<{ mentors: Mentor[]; total: number; pageSize: number }>(`/api/mentors?page=${peoplePage}&pageSize=20`),
  });
  const { data: convData, isLoading: convLoading } = useQuery({
    queryKey: ["conversations", convPage],
    queryFn: () =>
      http.get<{ conversations: Conversation[]; total: number; pageSize: number }>(
        `/api/chats/conversations?page=${convPage}&pageSize=10`,
      ),
  });
  const mentors = data?.mentors ?? [];
  const people = useMemo(() => {
    const list = [...mentors];
    if (alpha) list.sort((a, b) => a.name.localeCompare(b.name, "fa"));
    else list.sort((a, b) => Number(!!b.online) - Number(!!a.online) || a.name.localeCompare(b.name, "fa"));
    return list;
  }, [mentors, alpha]);
  const conversations = convData?.conversations ?? [];
  const peopleTotal = data?.total ?? mentors.length;
  const convTotal = convData?.total ?? conversations.length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="justify-center text-center" title="گفتگوها" description="یک پنجرهٔ شناور شیشه‌ای در تمام صفحات — با صدا، عکس، ویدیو و پیام صوتی.">
        <div className="flex flex-col items-center gap-4 pt-1">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
            <MessageSquareHeart className="h-7 w-7 text-primary" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            گفتگو همیشه در دکمهٔ شناور پایین صفحه در دسترس شماست؛ گفتگوها خصوصی هستند و پاسخ منتورها معمولاً کمتر از یک روز طول می‌کشد.
          </p>
          <Button onClick={() => openChat()} className="gap-2">
            <Sparkles className="h-4 w-4" /> باز کردن گفتگوها
          </Button>
        </div>
      </Panel>

      <Panel title="گفتگوهای شما" description="مکالمات جاری — روی هر کدام بزنید تا باز شود.">
        <div className="space-y-1.5 pt-1">
          {convLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border-2 border-border/70 px-3 py-2.5">
                  <SkeletonAvatar />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-14" />
                    </div>
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {conversations.map((c) => (
            <button
              key={c.partner.id}
              onClick={() => openChat(c.partner.id)}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-border/70 px-3 py-2.5 text-right transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <UserAvatar name={c.partner.name} className="h-10 w-10" {...avatarPropsOf(c.partner)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1 font-bold">
                    <span className="truncate">{c.partner.name}</span>
                    {isVerifiedRole(c.partner.role) && <VerifiedBadge role={c.partner.role} />}
                  </p>
                  {c.lastMessage && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">{formatJalaliStamp(c.lastMessage.createdAt)}</span>
                  )}
                </div>
                <p
                  dir="auto"
                  className={cn(
                    "truncate text-xs [unicode-bidi:plaintext]",
                    c.unreadCount > 0 ? "font-bold text-foreground" : "text-muted-foreground"
                  )}
                >
                  {c.lastMessage ? messagePreview(c.lastMessage) : "پیامی ندارد"}
                </p>
              </div>
              {c.unreadCount > 0 && (
                <Badge variant="accent" className="h-5 min-w-5 justify-center rounded-full px-1.5">
                  {c.unreadCount}
                </Badge>
              )}
            </button>
          ))}
          {!convLoading && conversations.length === 0 && (
            <p className="px-1 text-sm text-muted-foreground">
              هنوز گفتگویی ندارید — از فهرست کنار، یک نفر را انتخاب کنید.
            </p>
          )}
          {convTotal > (convData?.pageSize ?? 10) && (
            <div className="flex items-center justify-between pt-2 text-xs">
              <Button type="button" size="sm" variant="outline" disabled={convPage <= 1} onClick={() => setConvPage((p) => p - 1)}>
                قبلی
              </Button>
              <span className="text-muted-foreground">{convPage}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={convPage * (convData?.pageSize ?? 10) >= convTotal}
                onClick={() => setConvPage((p) => p + 1)}
              >
                بعدی
              </Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title={staff ? "شروع گفتگو" : "شروع سریع با منتور"}
        description="نقش هر نفر روی ردیف نوشته شده است."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => setAlpha((v) => !v)}>
            {alpha ? "آنلاین بالا" : "الفبایی"}
          </Button>
        }
      >
        <div className="space-y-1 pt-1">
          {isLoading && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border-2 border-border/70 px-3 py-2.5">
                  <SkeletonAvatar />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          )}
          {people.map((m) => (
            <motion.button
              layout
              key={m.id}
              onClick={() => openChat(m.id)}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-border/70 px-3 py-2.5 text-right transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <UserAvatar name={m.name} className="h-10 w-10" {...avatarPropsOf(m)} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1 font-bold">
                  <span className="truncate">{m.name}</span>
                  {isVerifiedRole(m.role) && <VerifiedBadge role={m.role} />}
                </p>
                <p className="text-xs text-muted-foreground">{roleWord(m.role)}</p>
              </div>
              <span className={cn("inline-flex items-center gap-1.5 text-xs font-bold", m.online ? "text-success" : "text-muted-foreground")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", m.online ? "bg-success" : "bg-muted-foreground/40")} />
                {m.online ? "آنلاین" : "آفلاین"}
              </span>
            </motion.button>
          ))}
          {!isLoading && mentors.length === 0 && (
            <p className="text-sm text-muted-foreground">{staff ? "کسی برای گفتگو نیست." : "هنوز منتوری در دسترس نیست."}</p>
          )}
          {peopleTotal > (data?.pageSize ?? 20) && (
            <div className="flex items-center justify-between pt-2 text-xs">
              <Button type="button" size="sm" variant="outline" disabled={peoplePage <= 1} onClick={() => setPeoplePage((p) => p - 1)}>
                قبلی
              </Button>
              <span className="text-muted-foreground">{peoplePage}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={peoplePage * (data?.pageSize ?? 20) >= peopleTotal}
                onClick={() => setPeoplePage((p) => p + 1)}
              >
                بعدی
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function messagePreview(m: ChatMessage) {
  if (m.body) return m.body;
  const atts = m.attachments?.length ? m.attachments : m.attachment ? [m.attachment] : [];
  if (atts.length > 1 && atts.every((a) => a.type === "image")) return `📷 ${atts.length.toLocaleString("fa-IR")} عکس`;
  if (atts.length > 1 && atts.every((a) => a.type === "file")) return `📎 ${atts.length.toLocaleString("fa-IR")} فایل`;
  if (atts.length > 1) return `📎 ${atts.length.toLocaleString("fa-IR")} پیوست`;
  if (atts[0]) {
    const labels: Record<string, string> = { image: "📷 عکس", video: "🎬 ویدیو", audio: "🎵 پیام صوتی" };
    return labels[atts[0].type] ?? `📎 ${atts[0].name}`;
  }
  return "";
}