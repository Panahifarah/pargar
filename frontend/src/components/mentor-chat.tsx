"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  CornerDownLeft,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  Loader2,
  Maximize,
  MessageSquare,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Search,
  Smile,
  SmilePlus,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, apiForm, http, getWsUrl } from "@/lib/api";
import type { ChatAttachment, ChatMessage, ChatReaction, Conversation, Mentor } from "@/lib/types";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { UserAvatar, avatarPropsOf } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "@/components/providers";
import { AppleEmoji, AppleEmojiText } from "@/components/apple-emoji";
import { softPop, softSpring, softTween } from "@/lib/motion";

const MAX_LEN = 4000;

const LAVA_STYLES: React.CSSProperties[] = [
  {
    background:
      "radial-gradient(circle at 40% 35%, color-mix(in srgb, var(--color-primary) 42%, transparent), transparent 70%)",
  },
  {
    background:
      "radial-gradient(circle at 55% 45%, color-mix(in srgb, var(--color-secondary) 38%, transparent), transparent 72%)",
  },
  {
    background:
      "radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--color-accent) 30%, transparent), transparent 68%)",
  },
];

function LavaLamp() {
  const orbs = [
    {
      cls: "-start-14 -top-14 h-60 w-60",
      x: [0, 110, 40, 140, 0],
      y: [0, 70, 150, 45, 0],
      s: [1, 1.3, 1.05, 1.35, 1],
      dur: 26,
    },
    {
      cls: "-end-16 top-1/4 h-52 w-52",
      x: [0, -90, -30, -120, 0],
      y: [0, -55, -130, -35, 0],
      s: [1, 1.2, 1.1, 1.28, 1],
      dur: 22,
    },
    {
      cls: "bottom-2 start-1/4 h-40 w-40",
      x: [0, 60, -40, 95, 0],
      y: [0, -70, -40, -110, 0],
      s: [1, 1.25, 0.95, 1.3, 1],
      dur: 30,
    },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 opacity-60">
      {orbs.map((o, i) => (
        <motion.div
          key={i}
          className={cn("absolute rounded-full blur-[70px] will-change-transform", o.cls)}
          style={LAVA_STYLES[i]}
          animate={{ x: o.x, y: o.y, scale: o.s }}
          transition={{ duration: o.dur, repeat: Infinity, ease: [0.45, 0.05, 0.25, 1], delay: i * 2.5 }}
        />
      ))}
    </div>
  );
}

export function ChatWidget() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [attPref, setAttPref] = useState<ChatAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notif, setNotif] = useState<{ id: string; partner: number; name: string; body: string } | null>(null);
  const [preview, setPreview] = useState<ChatAttachment | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [jumpDown, setJumpDown] = useState(false);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [delArm, setDelArm] = useState<number | null>(null);
  const [reactId, setReactId] = useState<number | null>(null);
  const [heartMsg, setHeartMsg] = useState<number | null>(null);
  const [hearts, setHearts] = useState<Record<number, number>>({});
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgQuery, setMsgQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [pinIdx, setPinIdx] = useState(0);
  const [flashId, setFlashId] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingSentAt = useRef(0);
  const typingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const suppressAutoScrollRef = useRef(false);
  const jumpTargetRef = useRef<number | null>(null);
  const pendingDraftRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const convRef = useRef<Conversation[]>([]);

const { data: convData } = useQuery({
        queryKey: ["conversations"],
        queryFn: () => http.get<{ conversations: Conversation[] }>("/api/chats/conversations"),
        refetchInterval: 20_000,
      });
  const conversations = convData?.conversations ?? [];
  convRef.current = conversations;
  const unreadTotal = useMemo(
    () => conversations.reduce((n, c) => n + (c.unreadCount > 0 ? c.unreadCount : 0), 0),
    [conversations]
  );

  const { data: loveList } = useQuery({
    queryKey: ["mentors"],
    queryFn: () => http.get<{ mentors: Mentor[] }>("/api/mentors"),
    enabled: !active && open,
  });

  const { data: messages } = useQuery({
    queryKey: ["chat", active],
    queryFn: () =>
      http.get<{ messages: ChatMessage[]; hasMore: boolean; pinned?: ChatMessage[] }>(
        `/api/chats/${active}/messages`,
      ),
    enabled: !!active,
    refetchInterval: active ? 5000 : false,
  });

  const pinned = messages?.pinned ?? [];
  const pinnedIds = useMemo(() => new Set(pinned.map((p) => p.id)), [pinned]);
  const activePin = pinned.length ? pinned[Math.min(pinIdx, pinned.length - 1)] ?? null : null;

  useEffect(() => {
    setPinIdx(0);
  }, [active]);

  useEffect(() => {
    if (pinned.length === 0) {
      setPinIdx(0);
      return;
    }
    setPinIdx((i) => (i >= pinned.length ? 0 : i));
  }, [pinned.length]);

  useEffect(() => {
    if (messages && typeof messages.hasMore === "boolean") setCanLoadMore(messages.hasMore);
  }, [messages?.hasMore, active]);

  const msgs = useMemo(() => {
    const all = [...older, ...(messages?.messages ?? []), ...pending];
    if (!all.length) return all;
    const byId = new Map<number, ChatMessage>();
    for (const m of all) byId.set(m.id, m);
    return [...byId.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [messages, older, pending]);

  const matchIds = useMemo(() => {
    const q0 = normText(msgQuery).trim();
    if (!q0) return [] as number[];
    return msgs
      .filter(
        (m) =>
          !!m.body && normText(m.body).includes(q0) || (!!m.attachment?.name && normText(m.attachment.name).includes(q0))
      )
      .map((m) => m.id);
  }, [msgs, msgQuery]);
  const matchCount = matchIds.length;
  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);

  useEffect(() => {
    setMatchIdx(0);
  }, [msgQuery]);

  useEffect(() => {
    if (!msgSearchOpen || !matchCount) return;
    const id = matchIds[matchIdx];
    if (id == null) return;
    const el = threadRef.current?.querySelector(`[data-mid="${id}"]`);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [matchIdx, msgSearchOpen, matchCount, msgQuery]);

  const loadOlder = async () => {
    const before = older[0]?.id ?? messages?.messages?.[0]?.id;
    if (!active || !before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await http.get<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/api/chats/${active}/messages?before=${before}`,
      );
      setOlder((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const add = res.messages.filter((m) => !seen.has(m.id));
        return [...add, ...prev];
      });
      setCanLoadMore(res.hasMore);
    } catch {
      /* ignore */
    } finally {
      setLoadingOlder(false);
    }
  };

  const delMsg = async (id: number) => {
    setDelArm(null);
    if (delArmTimer.current) clearTimeout(delArmTimer.current);
    if (!active) return;
    try {
      await http.del<{ ok: boolean }>(`/api/chats/${active}/messages/${id}`);
      setOlder((prev) => prev.filter((m) => m.id !== id));
      setPending((prev) => prev.filter((m) => m.id !== id));
      qc.invalidateQueries({ queryKey: ["chat", active] });
      qc.invalidateQueries({ queryKey: ["chat"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      /* ignore */
    }
  };

  const armDelete = (id: number) => {
    if (delArm === id) {
      void delMsg(id);
      return;
    }
    setDelArm(id);
    if (delArmTimer.current) clearTimeout(delArmTimer.current);
    delArmTimer.current = setTimeout(() => setDelArm(null), 3000);
  };

  const togglePin = async (m: ChatMessage) => {
    if (!active || m.id <= 0) return;
    try {
      await api<{ ok: boolean; message: ChatMessage }>(`/api/chats/${active}/messages/${m.id}/pin`, {
        method: "POST",
      });
      qc.invalidateQueries({ queryKey: ["chat", active] });
    } catch (e) {
      toast.error((e as Error)?.message || "پین پیام ممکن نشد");
    }
  };

  const flashMessage = (id: number) => {
    const thread = threadRef.current;
    const el = thread?.querySelector(`[data-mid="${id}"]`) as HTMLElement | null;
    if (!thread || !el) return false;
    const elRect = el.getBoundingClientRect();
    const threadRect = thread.getBoundingClientRect();
    const nextTop =
      thread.scrollTop + (elRect.top - threadRect.top) - thread.clientHeight / 2 + el.clientHeight / 2;
    thread.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    wasNearBottomRef.current = false;
    setJumpDown(true);
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlashId((cur) => (cur === id ? null : cur));
    }, 1500);
    return true;
  };

  const clearJumpTarget = () => {
    jumpTargetRef.current = null;
    window.setTimeout(() => {
      suppressAutoScrollRef.current = false;
    }, 500);
  };

  const jumpToMessage = async (id: number) => {
    if (!active) return;
    suppressAutoScrollRef.current = true;
    jumpTargetRef.current = id;

    if (flashMessage(id)) {
      clearJumpTarget();
      return;
    }

    if (msgs.some((m) => m.id === id)) return;

    setLoadingOlder(true);
    try {
      const res = await http.get<{
        messages: ChatMessage[];
        hasMore?: boolean;
        hasMoreBefore?: boolean;
        pinned?: ChatMessage[];
      }>(`/api/chats/${active}/messages?around=${id}`);
      if (!res.messages?.length) {
        clearJumpTarget();
        toast.error("پیام پیدا نشد");
        return;
      }
      setOlder((prev) => {
        const byId = new Map<number, ChatMessage>();
        for (const m of [...res.messages, ...prev]) byId.set(m.id, m);
        return [...byId.values()].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      });
      if (typeof res.hasMoreBefore === "boolean") setCanLoadMore(res.hasMoreBefore);
      else if (typeof res.hasMore === "boolean") setCanLoadMore(res.hasMore);
      qc.setQueryData(["chat", active], (old: typeof messages) => {
        if (!old) return old;
        return { ...old, pinned: res.pinned ?? old.pinned };
      });
      // Paint + jump handled by effect watching msgs / jumpTargetRef.
    } catch {
      clearJumpTarget();
      toast.error("بارگذاری پیام ممکن نشد");
    } finally {
      setLoadingOlder(false);
    }
  };

  const toggleReact = async (m: ChatMessage, emoji: string) => {
    if (!active || m.id <= 0) return;
    try {
      await api<{ ok: boolean }>(`/api/chats/${active}/messages/${m.id}/reaction`, { method: "POST", body: { emoji } });
      qc.invalidateQueries({ queryKey: ["chat"] });
    } catch {
      toast.error("ثبت واکنش ممکن نشد");
    }
  };

  const like = (m: ChatMessage) => {
    if (m.id <= 0) return;
    setHearts((h) => ({ ...h, [m.id]: (h[m.id] ?? 0) + 1 }));
    setHeartMsg(m.id);
    if (heartTimer.current) clearTimeout(heartTimer.current);
    heartTimer.current = setTimeout(() => setHeartMsg(null), 720);
    void toggleReact(m, "❤️");
  };

  useEffect(() => {
    if (!active) return;
    api<{ ok: boolean }>(`/api/chats/${active}/read`, { method: "POST" })
      .then(() => qc.invalidateQueries({ queryKey: ["conversations"] }))
      .catch(() => undefined);
  }, [active, qc]);

  useEffect(() => {
    if (active && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
    wasNearBottomRef.current = true;
    suppressAutoScrollRef.current = false;
    jumpTargetRef.current = null;
  }, [active]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (suppressAutoScrollRef.current) return;
    if (wasNearBottomRef.current || pending.length) {
      el.scrollTop = el.scrollHeight;
    }
  }, [msgs, pending]);

  useEffect(() => {
    const id = jumpTargetRef.current;
    if (id == null) return;
    if (!msgs.some((m) => m.id === id)) return;
    let cancelled = false;
    const tryFlash = (attempt: number) => {
      if (cancelled) return;
      if (flashMessage(id)) {
        clearJumpTarget();
        return;
      }
      if (attempt < 8) {
        window.setTimeout(() => tryFlash(attempt + 1), 40);
      } else {
        clearJumpTarget();
        toast.error("پیام پیدا نشد");
      }
    };
    requestAnimationFrame(() => tryFlash(0));
    return () => {
      cancelled = true;
    };
  }, [msgs]);

  useEffect(() => {
    if (!active || !me) return;
    if (draft) localStorage.setItem(`mt.draft.${me.id}.${active}`, draft);
    else localStorage.removeItem(`mt.draft.${me.id}.${active}`);
  }, [draft, active, me]);

  useEffect(() => {
    setPartnerTyping(false);
    return () => {
      if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
    };
  }, [active]);

  useEffect(() => {
    setReplyTo(null);
    setEmojiOpen(false);
    setOlder([]);
    setCanLoadMore(false);
    setDelArm(null);
    if (delArmTimer.current) clearTimeout(delArmTimer.current);
    setReactId(null);
    setHeartMsg(null);
    setHearts({});
    if (heartTimer.current) clearTimeout(heartTimer.current);
    setFlashId(null);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setMsgSearchOpen(false);
    setMsgQuery("");
    setMatchIdx(0);
    if (pendingDraftRef.current != null) {
      const d = pendingDraftRef.current;
      pendingDraftRef.current = null;
      setDraft(d);
    } else {
      setDraft(active ? localStorage.getItem(`mt.draft.${me?.id}.${active}`) ?? "" : "");
    }
  }, [active, me?.id]);

  useEffect(() => {
    if (open && active) {
      const t = setTimeout(() => taRef.current?.focus(), 140);
      return () => clearTimeout(t);
    }
  }, [open, active]);

  useEffect(() => {
    if (!open) setNotif(null);
  }, [open]);

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ open?: boolean; with?: number; draft?: string }>).detail;
      if (typeof detail?.draft === "string") {
        pendingDraftRef.current = detail.draft;
      }
      if (detail?.with) {
        setActive(detail.with);
      } else if (typeof detail?.draft === "string") {
        setDraft(detail.draft);
        pendingDraftRef.current = null;
      }
      setOpen(detail?.open ?? true);
    };
    window.addEventListener("pargar:chat", onOpen);
    return () => window.removeEventListener("pargar:chat", onOpen);
  }, []);

  useEffect(() => {
    const { accessToken: token, user } = useAuth.getState();
    let cancelled = false;
    if (!user) return;
    // Prefer bearer subprotocol; fall back to httpOnly cookie on same-origin.
    const ws = token ? new WebSocket(getWsUrl(), ["bearer", token]) : new WebSocket(getWsUrl());
    wsRef.current = ws;
ws.onmessage = (ev) => {
      try {
        const p = JSON.parse(ev.data) as { type?: string; from?: number; item?: ChatMessage };
        if (p.type === "chat_message") {
          qc.invalidateQueries({ queryKey: ["conversations"] });
          if (p.from && activeRef.current === p.from) {
            qc.invalidateQueries({ queryKey: ["chat"] });
            api<{ ok: boolean }>(`/api/chats/${p.from}/read`, { method: "POST" }).catch(() => undefined);
          }
          const mine = p.from === useAuth.getState().user?.id;
          if (!mine && !cancelled) {
            const activeThread = !!activeRef.current && activeRef.current === p.from;
            if (!activeThread) {
              const conv = convRef.current.find((c) => c.partner.id === p.from);
              if (conv) {
                setNotif({
                  id: `${Date.now()}-${p.from}`,
                  partner: p.from ?? 0,
                  name: conv.partner.name,
                  body: p.item ? previewOf(p.item) : "پیام جدید",
                });
                if (notifTimer.current) clearTimeout(notifTimer.current);
                notifTimer.current = setTimeout(() => setNotif(null), 5000);
              }
            }
          }
        } else if (p.type === "typing") {
          if (p.from && activeRef.current === p.from) {
            setPartnerTyping(true);
            if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
            typingClearTimer.current = setTimeout(() => setPartnerTyping(false), 4500);
          }
        } else if (p.type === "chat_reaction") {
          if (p.from && activeRef.current === p.from) qc.invalidateQueries({ queryKey: ["chat"] });
        } else if (p.type === "chat_delete") {
          const deletedId = (p as { id?: number }).id;
          if (deletedId) {
            setOlder((prev) => prev.filter((m) => m.id !== deletedId));
            setPending((prev) => prev.filter((m) => m.id !== deletedId));
          }
          qc.invalidateQueries({ queryKey: ["conversations"] });
          qc.invalidateQueries({ queryKey: ["chat"] });
        } else if (p.type === "chat_pin") {
          qc.invalidateQueries({ queryKey: ["chat"] });
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      cancelled = true;
      wsRef.current = null;
      ws.close();
    };
  }, [qc]);

  const signalTyping = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !active) return;
    const now = Date.now();
    if (now - typingSentAt.current < 2400) return;
    typingSentAt.current = now;
    ws.send(JSON.stringify({ type: "typing", to: active }));
  };

  const partner =
    conversations.find((c) => c.partner.id === active)?.partner ??
    (loveList?.mentors ?? []).find((m) => m.id === active);

  const send = async (text?: string, att?: ChatAttachment | null) => {
    const body = (text ?? draft).trim();
    if (!active || (!body && !att && !attPref) || body.length > MAX_LEN || sending) return;
    setSending(true);
    const attachment = att ?? attPref ?? undefined;
    const quoteId = replyTo?.id;
    const uid = useAuth.getState().user;
    const temp: ChatMessage = {
      id: -Date.now(),
      userId: uid?.role === "mentor" ? active : (uid?.id ?? 0),
      mentorId: uid?.role === "mentor" ? (uid?.id ?? 0) : active,
      senderRole: (uid?.role ?? "student") as ChatMessage["senderRole"],
      body,
      createdAt: new Date().toISOString(),
      ...(attachment ? { attachment } : {}),
      ...(quoteId ? { replyTo: quoteId } : {}),
    };
    setDraft("");
    setAttPref(null);
    setReplyTo(null);
    setPending((p) => [...p, temp]);
try {
      const res = await api<{ message: ChatMessage }>(`/api/chats/${active}/messages`, {
        method: "POST",
        body: { body, attachment, replyTo: quoteId },
      });
      qc.setQueryData<{ messages: ChatMessage[]; hasMore: boolean }>(["chat", active], (old) => {
        const list = old?.messages ?? [];
        if (!list.some((x) => x.id === res.message.id)) {
          return { ...old, messages: [...list, res.message] } as typeof old;
        }
        return old;
      });
      setPending([]);
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      setPending([]);
      setDraft(body);
      setAttPref(attachment ?? null);
      setReplyTo(replyTo);
      toast.error((err as Error).message || "ارسال ممکن نشد");
    } finally {
      setSending(false);
    }
  };

  const pickFile = () => fileRef.current?.click();

  const uploadSelected = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast.error("فایل باید کمتر از ۲۵ مگابایت باشد");
      return;
    }
    setUploading(true);
    try {
      const { attachment } = await apiForm<{ attachment: ChatAttachment }>("/api/chats/upload", toForm(file));
      setAttPref(attachment);
    } catch (err) {
      toast.error((err as Error).message || "آپلود ممکن نشد");
    } finally {
      setUploading(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await uploadSelected(file);
  };

  const voiceRef = useRef<{
    recorder: MediaRecorder | null;
    stream: MediaStream | null;
    chunks: Blob[];
    timer: ReturnType<typeof setInterval>;
    start: number;
    live?: () => void;
  } | null>(null);
  const [recSec, setRecSec] = useState(0);
  const [recLevel, setRecLevel] = useState(0);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  const [recBlob, setRecBlob] = useState<Blob | null>(null);
  const [recMime, setRecMime] = useState<string | undefined>(undefined);
  const [recDur, setRecDur] = useState(0);

  useEffect(() => {
    return () => {
      const v = voiceRef.current;
      if (v?.recorder && v.recorder.state !== "inactive") v.recorder.stop();
      v?.stream?.getTracks().forEach((t) => t.stop());
      if (v?.timer) clearInterval(v.timer);
    };
  }, []);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const cancelVoicePreview = () => {
    if (recUrl) URL.revokeObjectURL(recUrl);
    setRecUrl(null);
    setRecBlob(null);
    setRecMime(undefined);
    setRecDur(0);
  };

  const sendVoice = async () => {
    const blob = recBlob;
    const mime = recMime;
    if (!blob || !active || sending || uploading) return;
    cancelVoicePreview();
    setUploading(true);
    try {
      const { attachment } = await apiForm<{ attachment: ChatAttachment }>("/api/chats/upload", toForm(blob, mime));
      await send("", attachment);
    } catch (err) {
      toast.error((err as Error).message || "ارسال صوتی ممکن نشد");
    } finally {
      setUploading(false);
    }
  };

  const toggleMic = async () => {
    const v = voiceRef.current;
    if (v?.recorder && v.recorder.state === "recording") {
      v.recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mime ?? "audio/webm" });
        const secs = Math.round((Date.now() - (voiceRef.current?.start ?? Date.now())) / 1000);
        clearInterval(voiceRef.current?.timer);
        voiceRef.current?.live?.();
        stream.getTracks().forEach((t) => t.stop());
        setRecSec(0);
        setRecLevel(0);
        voiceRef.current = null;
        if (secs < 1 || blob.size === 0) {
          toast.error("پیام صوتی خیلی کوتاه بود");
          return;
        }
        setRecUrl(URL.createObjectURL(blob));
        setRecBlob(blob);
        setRecMime(mime);
        setRecDur(secs);
      };
      recorder.start(250);
      let liveStop: (() => void) | undefined;
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.6;
          src.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const liveTick = window.setInterval(() => {
            analyser.getByteTimeDomainData(data);
            let max = 0;
            for (let i = 0; i < data.length; i++) {
              const v = Math.abs(data[i] - 128) / 128;
              if (v > max) max = v;
            }
            setRecLevel(Math.max(0.05, Math.min(1, max * 1.8)));
          }, 60);
          liveStop = () => {
            clearInterval(liveTick);
            void ctx.close();
          };
        }
      } catch {
        /* mic level meter optional */
      }
      voiceRef.current = {
        recorder,
        stream,
        chunks,
        timer: setInterval(() => setRecSec((s) => s + 1), 1000),
        start: Date.now(),
        live: liveStop,
      };
    } catch {
      toast.error("دسترسی به میکروفون ممکن نشد");
    }
  };

  const cancelVoice = () => {
    const v = voiceRef.current;
    if (v?.stream) {
      v.live?.();
      v.stream.getTracks().forEach((t) => t.stop());
      clearInterval(v.timer);
      setRecSec(0);
      setRecLevel(0);
      voiceRef.current = null;
    }
  };

  const sortedConvs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...conversations].sort((a, b) => {
      const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return tb - ta;
    });
    if (!q) return list;
    return list.filter(
      (c) => c.partner.name.toLowerCase().includes(q) || (c.lastMessage?.body ?? "").toLowerCase().includes(q)
    );
  }, [conversations, query]);

  const thread = useMemo(() => buildThread(msgs, me?.role), [msgs, me?.role]);
  const emptyThread = msgs.length === 0;
  const atLimit = draft.length >= MAX_LEN;
  const recording = !!voiceRef.current?.recorder && voiceRef.current.recorder.state === "recording";

  const firstUnread = useMemo(() => {
    if (!me) return null;
    for (const m of msgs) {
      if (!isMineMsg(m, me.role) && !m.readAt) return m.id;
    }
    return null;
  }, [msgs, me]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="mt-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={softTween}
              onClick={() => {
                setOpen(false);
                setActive(null);
              }}
              className="fixed inset-0 z-[65] bg-background/35 backdrop-blur-[2px]"
            />
            <motion.div
              key="mt-panel"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={softSpring}
              className="fixed bottom-24 start-3 end-3 z-[66] flex h-[min(640px,calc(100svh-10rem))] w-auto flex-col overflow-hidden rounded-[26px] border border-white/60 bg-white/55 shadow-[0_24px_70px_-18px_rgba(42,39,69,0.4)] ring-1 ring-black/5 backdrop-blur-2xl sm:bottom-6 sm:start-5 sm:end-auto sm:h-[min(720px,calc(100svh-3rem))] sm:w-[420px] dark:border-white/15 dark:bg-[#14172b]/60 dark:ring-white/10 xl:start-8 xl:w-[440px]"
            >
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-primary via-accent to-gold" />
              <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 h-40 w-40 rounded-full bg-accent/25 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -start-16 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />

              <div className="relative flex items-center gap-3 border-b-2 border-white/50 bg-white/30 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                {active && partner ? (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setActive(null)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <div className="relative">
                      <UserAvatar name={partner.name} className="h-9 w-9" {...avatarPropsOf(partner)} />
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                          partner.online ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-muted-foreground/40"
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold">{partner.name}</p>
                      {partnerTyping ? (
                        <p className="flex items-center gap-1 text-[11px] font-bold text-primary">
                          <TypingDots /> در حال تایپ است
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">{roleLabel(partner.role)}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15">
                      <MessageSquare className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-extrabold">گفتگوها</p>
                    </div>
                  </>
                )}
                <button
                  onClick={() => {
                    setOpen(false);
                    setActive(null);
                  }}
                  aria-label="بستن"
                  className="grid h-8 w-8 place-items-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
                {active && (
                  <button
                    onClick={() => setMsgSearchOpen((o) => !o)}
                    aria-label="جستجو در گفتگو"
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-lg bg-muted/60 transition-colors",
                      msgSearchOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Search className="h-4 w-4" />
                  </button>
                )}
                {!active && (
                  <button
                    onClick={() => setComposeOpen((value) => !value)}
                    aria-label="شروع گفتگوی جدید"
                    title="گفتگوی جدید"
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-lg bg-muted/60 transition-colors",
                      composeOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <ThemeToggle />
              </div>

              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {!active ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="shrink-0 p-3 pb-1">
                      <div className="relative">
                        <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="جستجو در گفتگوها…"
                          dir="rtl"
                          className="h-9 w-full rounded-xl border-2 border-border bg-background/60 ps-8 pe-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/80 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-3 chat-scroll">
                      {composeOpen && (
                        <div className="mb-3 rounded-2xl border-2 border-primary/20 bg-primary/5 p-3">
                          <p className="mb-2 text-xs font-bold text-muted-foreground">شروع گفتگوی جدید</p>
                          {(loveList?.mentors ?? []).map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setActive(m.id);
                                setComposeOpen(false);
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-primary/10"
                            >
                              <UserAvatar name={m.name} className="h-8 w-8" {...avatarPropsOf(m)} />
                              <span className="font-medium">{m.name}</span>
                              <span className="ms-auto text-[10px] text-muted-foreground">{roleLabel(m.role)}</span>
                            </button>
                          ))}
                          {(loveList?.mentors ?? []).length === 0 && (
                            <p className="text-xs text-muted-foreground">مخاطب مجازی برای گفتگو وجود ندارد.</p>
                          )}
                        </div>
                      )}
                      {sortedConvs.map((c) => (
                        <button
                          key={c.partner.id}
                          onClick={() => {
                            setActive(c.partner.id);
                            setComposeOpen(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-2xl border-2 border-border/70 bg-background/50 px-3 py-2.5 text-right text-sm transition-colors hover:border-primary/40 hover:bg-background/80"
                        >
                          <div className="relative shrink-0">
                          <UserAvatar name={c.partner.name} className="h-10 w-10" {...avatarPropsOf(c.partner)} />
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                              c.partner.online ? "bg-success" : "bg-muted-foreground/40"
                            )}
                          />
                        </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate font-bold">{c.partner.name}</p>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {c.lastMessage ? clock(c.lastMessage.createdAt) : ""}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <p
                                dir="auto"
                                className={cn(
                                  "truncate text-xs",
                                  c.unreadCount > 0 ? "font-bold text-foreground" : "text-muted-foreground"
                                )}
                              >
                                {c.lastMessage ? previewOf(c.lastMessage) : "هنوز پیامی نیست"}
                              </p>
                              {c.unreadCount > 0 && (
                                <span className="ms-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-black text-accent-foreground">
                                  {fa(c.unreadCount)}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}

                      {sortedConvs.length === 0 && conversations.length > 0 && (
                        <p className="px-1 py-3 text-center text-xs text-muted-foreground">گفتگویی یافت نشد.</p>
                      )}
                      {conversations.length === 0 && !composeOpen && (
                        <div className="space-y-1 p-1">
                          <p className="mb-2 text-xs font-bold text-muted-foreground">برای شروع، روی مداد بزنید</p>
                          {(loveList?.mentors ?? []).map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setActive(m.id);
                                setComposeOpen(false);
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-primary/10"
                            >
                              <UserAvatar name={m.name} className="h-7 w-7" {...avatarPropsOf(m)} />
                              <span className="font-medium">{m.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    {msgSearchOpen && (
                      <div className="relative z-30 flex items-center gap-1.5 border-b-2 border-white/40 bg-background/70 px-3 py-2 backdrop-blur-md dark:border-white/10">
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <input
                          value={msgQuery}
                          onChange={(e) => setMsgQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (!matchCount) return;
                            if (e.key === "Escape") { e.preventDefault(); setMsgSearchOpen(false); setMsgQuery(""); setMatchIdx(0); }
                            else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setMatchIdx((i) => (i + 1) % matchCount); }
                            else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); setMatchIdx((i) => (i - 1 + matchCount) % matchCount); }
                          }}
                          placeholder="جستجو در این گفتگو…"
                          dir="rtl"
                          autoFocus
                          className="h-8 min-w-0 flex-1 rounded-lg border-2 border-border bg-background/70 px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        {msgQuery.trim() !== "" && (
                          <span className={cn("shrink-0 text-[11px] font-bold tabular-nums", matchCount ? "text-muted-foreground" : "text-destructive")}>
                            {matchCount ? `${fa(matchIdx + 1)}/${fa(matchCount)}` : "پیدا نشد"}
                          </span>
                        )}
                        <button
                          onClick={() => setMatchIdx((i) => (i - 1 + matchCount) % matchCount)}
                          disabled={!matchCount}
                          aria-label="نتیجه قبلی"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setMatchIdx((i) => (i + 1) % matchCount)}
                          disabled={!matchCount}
                          aria-label="نتیجه بعدی"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            setMsgSearchOpen(false);
                            setMsgQuery("");
                            setMatchIdx(0);
                          }}
                          aria-label="بستن جستجو"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {activePin && (
                      <div className="relative z-30 shrink-0 border-b border-gold/30 bg-gold/10 px-2.5 py-1.5 backdrop-blur-md">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void jumpToMessage(activePin.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-start transition hover:bg-gold/15"
                            title="پرش به پیام پین‌شده"
                          >
                            <Pin className="h-3.5 w-3.5 shrink-0 text-gold" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-[10px] font-extrabold text-gold">
                                پین شده
                                {pinned.length > 1 && (
                                  <span className="tabular-nums text-gold/80">
                                    {fa(pinIdx + 1)}/{fa(pinned.length)}
                                  </span>
                                )}
                              </span>
                              <PinnedPreview m={activePin} />
                            </span>
                          </button>
                          {pinned.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setPinIdx((i) => (i + 1) % pinned.length)}
                              className="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                              title="پین بعدی"
                            >
                              بعدی
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void togglePin(activePin)}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                            aria-label="برداشتن پین"
                            title="برداشتن پین"
                          >
                            <PinOff className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="relative min-h-0 flex-1 overflow-hidden">
                      <LavaLamp />
                      <div
                        ref={threadRef}
                        onScroll={() => {
                          const el = threadRef.current;
                          if (!el) return;
                          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
                          wasNearBottomRef.current = near;
                          setJumpDown(!near);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOver(false);
                          const f = e.dataTransfer.files?.[0];
                          if (f) void uploadSelected(f);
                        }}
                        dir="ltr"
                        className="relative z-10 h-full min-h-0 space-y-1 overflow-y-auto overscroll-contain p-3 chat-scroll"
                      >
                        {dragOver && (
                          <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
                            <p className="text-sm font-extrabold text-primary">فایل را رها کنید</p>
                          </div>
                        )}
                        {emptyThread && (
                          <div className="mx-auto max-w-[260px] space-y-3 pt-8 text-center">
                            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10">
                              <MessageSquare className="h-6 w-6 text-primary" />
                            </div>
                            <p className="text-sm font-medium text-muted-foreground">
                              سلام کنید — کمک بگیرید، مشکلات را بگویید یا موفقیت را جشن بگیرید.
                            </p>
                            <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-[11px] font-bold text-foreground dark:bg-accent/25">
                              <Sparkles className="h-3 w-3" /> پاسخ کمتر از یک روز
                            </span>
                          </div>
                        )}

                        {canLoadMore && (
                          <div className="flex justify-center py-1.5">
                            <button
                              onClick={() => void loadOlder()}
                              disabled={loadingOlder}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-[10px] font-extrabold text-muted-foreground shadow-soft transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
                            >
                              {loadingOlder ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" /> در حال بارگذاری…
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="h-3 w-3 rotate-90" /> پیام‌های قبلی
                                </>
                              )}
                            </button>
                          </div>
                        )}

                        {thread.map((seg, i) =>
                          seg.kind === "date" ? (
                            <div key={`d-${i}`} className="flex justify-center py-1.5">
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-[10px] font-bold text-muted-foreground shadow-soft">
                                <span className="h-1 w-1 rounded-full bg-primary/60" />
                                {seg.label}
                              </span>
                            </div>
                          ) : (
                            <>
                              {firstUnread && seg.msgs.some((mm) => mm.id === firstUnread) && (
                                <div className="my-1.5 flex w-full items-center gap-2">
                                  <div className="h-px flex-1 bg-gradient-to-r from-transparent to-accent/50" />
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[10px] font-extrabold text-accent-foreground">
                                    <Sparkles className="h-3 w-3" /> پیام‌های جدید
                                  </span>
                                  <div className="h-px flex-1 bg-gradient-to-l from-transparent to-accent/50" />
                                </div>
                              )}
                              <div className="group flex w-full items-end gap-1.5">
                                {!seg.mine && (
                                  <UserAvatar name={partner?.name ?? "؟"} className="mb-0.5 h-7 w-7 shrink-0" {...avatarPropsOf(partner)} />
                                )}
                                <div className={cn("flex min-w-0 items-end gap-1", seg.mine ? "ml-auto" : "mr-auto")}>
                                  <div className={cn("flex min-w-0 flex-col", seg.mine ? "items-end" : "items-start")}>
                                    {seg.msgs.map((m, idx) => {
                                      const isLast = idx === seg.msgs.length - 1;
                                      const mediaOnly = !!m.attachment && !m.body;
                                      const isPending = m.id < 0;
                                      const isGif = mediaOnly && isGifName(m.attachment!);
                                      const onlyEmoji =
                                        !m.replyTo && !m.attachment && !!m.body && isSingleEmoji(m.body);
                                      const q0 = msgQuery.trim();
                                      const dimmed = q0 !== "" && matchCount > 0 && !matchSet.has(m.id);
                                      const isCurrent = matchSet.has(m.id) && m.id === matchIds[matchIdx];
                                      return (
                                        <div
                                          key={m.id}
                                          data-mid={m.id}
                                          onDoubleClick={() => like(m)}
                                          onClick={(e) => {
                                            const t = e.target as HTMLElement;
                                            if (t.closest("button, a, input, [role='button']")) return;
                                            setReactId((cur) => (cur === m.id ? null : m.id));
                                          }}
                                          className={cn(
                                            "relative isolate group/msg max-w-full min-w-0",
                                            !isLast && "mb-1",
                                            dimmed && "opacity-30 saturate-50",
                                            isCurrent && "ring-2 ring-accent rounded-xl",
                                          )}
                                        >
                                          <AnimatePresence>
                                            {heartMsg === m.id && reactId !== m.id && (
                                              <motion.span
                                                key={hearts[m.id] ?? 0}
                                                initial={{ scale: 0.2, opacity: 0, y: 10, rotate: -12 }}
                                                animate={{ scale: 1, opacity: 1, y: 0, rotate: 6 }}
                                                exit={{ scale: 1.35, opacity: 0, y: -20, rotate: 0 }}
                                                transition={softPop}
                                                className="pointer-events-none absolute inset-0 z-40 grid place-items-center"
                                              >
                                                <AppleEmoji emoji="❤️" size={48} />
                                              </motion.span>
                                            )}
                                          </AnimatePresence>
                                          <motion.div
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={softTween}
                                            className={cn(
                                              mediaOnly && !isGif
                                                ? "overflow-hidden"
                                                : onlyEmoji || isGif
                                                  ? "bg-transparent px-1.5 py-1"
                                                  : "max-w-full px-3.5 py-2 text-sm leading-relaxed",
                                              !onlyEmoji &&
                                                !isGif &&
                                                (seg.mine
                                                  ? cn(
                                                      "bg-primary text-primary-foreground shadow-[0_1px_1px_rgba(0,0,0,0.12)]",
                                                      isLast ? "rounded-[18px] rounded-tr-[6px]" : "rounded-[14px]",
                                                    )
                                                  : cn(
                                                      "border border-border/60 bg-card shadow-[0_1px_1px_rgba(0,0,0,0.06)]",
                                                      isLast ? "rounded-[18px] rounded-tl-[6px]" : "rounded-[14px]",
                                                    )),
                                              flashId === m.id && "chat-msg-glow",
                                            )}
                                          >
                                            {mediaOnly && isGif ? (
                                              <GifSticker
                                                att={m.attachment!}
                                                mine={seg.mine}
                                                time={m.createdAt}
                                                pending={isPending}
                                                onPreview={setPreview}
                                              />
                                            ) : mediaOnly ? (
                                            <>
                                              <MediaOnly att={m.attachment!} mine={seg.mine} time={m.createdAt} onPreview={setPreview} />
                                              </>
                                          ) : onlyEmoji ? (
                                            <>
                                              <p
                                                dir="auto"
                                                className="whitespace-pre-wrap break-words leading-[1.15] [unicode-bidi:plaintext]"
                                              >
                                                <AppleEmoji emoji={m.body!} size={54} />
                                              </p>
                                            </>
                                          ) : (
                                            <>
                                              {m.replyTo && (
                                                <QuoteBox
                                                  q={msgs.find((x) => x.id === m.replyTo) ?? null}
                                                  mine={seg.mine}
                                                  partnerName={partner?.name}
                                                  meRole={me?.role}
                                                />
                                              )}
                                              {m.attachment && (
                                                <AttachmentView
                                                  att={m.attachment}
                                                  mine={seg.mine}
                                                  time={m.createdAt}
                                                  onPreview={setPreview}
                                                />
                                              )}
                                              {m.body && (
                                                <p
                                                  dir="auto"
                                                  className={cn("whitespace-pre-wrap break-words [unicode-bidi:plaintext]", m.attachment && "mt-1")}
                                                >
                                                  <HighlightBody text={m.body} q={msgQuery} />
                                                </p>
                                              )}
                                              {m.body && (
                                                <span
                                                  className={cn(
                                                    "mt-1 flex items-center gap-1 text-[10px] leading-none",
                                                    seg.mine ? "justify-end" : "justify-start"
                                                  )}
                                                >
                                                  <span className={cn("opacity-75", seg.mine ? "text-primary-foreground" : "text-muted-foreground")}>
                                                    {clock(m.createdAt)}
                                                  </span>
                                                  {seg.mine &&
                                                    (isPending ? (
                                                      <Clock className="h-3.5 w-3.5 animate-spin text-primary-foreground/75 [animation-duration:1.6s]" />
                                                    ) : (
                                                      <SeenTicks read={!!m.readAt} />
                                                    ))}
                                                </span>
                                              )}
                                            </>
                                          )}
                                          </motion.div>
                                          {!!m.reactions?.length && (
                                            <div
                                              className={cn(
                                                "relative z-20 -mt-1.5 w-fit",
                                                seg.mine ? "ms-auto -me-1.5" : "me-auto -ms-1.5"
                                              )}
                                            >
                                              <ReactChips
                                                reactions={m.reactions}
                                                mine={seg.mine}
                                                onReact={(em) => void toggleReact(m, em)}
                                              />
                                            </div>
                                          )}
                                          <MsgActions
                                            mine={seg.mine}
                                            voice={m.attachment?.type === "audio"}
                                            media={mediaOnly}
                                            armed={delArm === m.id}
                                            pinned={pinnedIds.has(m.id) || !!m.pinned}
                                            open={reactId === m.id}
                                            onReact={() => setReactId(reactId === m.id ? null : m.id)}
                                            onReactEmoji={(em) => {
                                              setReactId(null);
                                              void toggleReact(m, em);
                                            }}
                                            onReply={() => setReplyTo(m)}
                                            onCopy={() => copyText(m)}
                                            onPin={() => void togglePin(m)}
                                            onDelete={() => armDelete(m.id)}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </>
                          )
                        )}
                      </div>
                      <AnimatePresence>
                        {jumpDown && (
                          <motion.button
                            key="jump-down"
                            initial={{ opacity: 0, y: 10, scale: 0.85 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.85 }}
                            transition={softSpring}
                            onClick={() => {
                              const el = threadRef.current;
                              if (el) el.scrollTop = el.scrollHeight;
                              wasNearBottomRef.current = true;
                              setJumpDown(false);
                            }}
                            aria-label="برو به آخرین پیام"
                            className="absolute bottom-3 end-3 z-30 grid h-9 w-9 place-items-center rounded-full border-2 border-primary/50 bg-card/95 text-primary shadow-soft ring-2 ring-white/40 backdrop-blur-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground active:scale-90 dark:bg-[#1a1e33]/95 dark:ring-black/30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>

                    {partnerTyping && (
                      <div className="flex shrink-0 items-center gap-2 border-t border-border/40 bg-background/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                        <TypingDots />
                        {partner?.name} در حال تایپ است…
                      </div>
                    )}

                    {emptyThread && (
                      <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pt-2">
                        {(me?.role === "student" ? STUDENT_SUGGESTIONS : MENTOR_SUGGESTIONS).map((q) => (
                          <button
                            key={q}
                            onClick={() => send(q)}
                            disabled={sending}
                            className="rounded-full border-2 border-primary/30 bg-primary/5 px-3 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="relative z-20 mx-2 mb-2 shrink-0 pt-1">
                      {recording && (
                        <div className="mb-2 flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2">
                          <div className="flex h-3.5 min-w-9 items-center justify-center gap-[2px]">
                            {Array.from({ length: 9 }).map((_, i) => {
                              const on = recLevel > (i + 1) / 9;
                              return (
                                <span
                                  key={i}
                                  className={cn("w-[3px] rounded-full transition-colors duration-75", on ? "bg-destructive" : "bg-destructive/25")}
                                  style={{ height: `${12 + ((i % 3) + 1) * 14}%` }}
                                />
                              );
                            })}
                          </div>
                          <span className="flex-1 text-xs font-bold text-destructive tabular-nums">{clockDur(recSec)}</span>
                          <button onClick={cancelVoice} aria-label="انصراف از ضبط" className="text-destructive/70 hover:text-destructive">
                            <X className="h-4 w-4" />
                          </button>
                          <button onClick={toggleMic} aria-label="پایان ضبط" className="text-destructive">
                            <Square className="h-4 w-4 fill-current" />
                          </button>
                        </div>
                      )}

                      {(attPref || uploading) && (
                        <div className="relative mb-2 flex items-center gap-2 overflow-hidden rounded-xl border-2 border-border/70 bg-muted/40 px-3 py-2">
                          {uploading && (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/10">
                              <span className="block h-full w-1/3 animate-[metaprog_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-primary/70 via-primary to-accent/70" />
                            </span>
                          )}
                          {uploading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              <span className="flex-1 text-xs font-medium text-muted-foreground">در حال آپلود…</span>
                            </>
                          ) : attPref ? (
                            <>
                              {attPref.type === "image" ? (
                                <button
                                  type="button"
                                  onClick={() => setPreview(attPref)}
                                  aria-label="پیش‌نمایش تصویر"
                                  className="group relative h-28 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded-xl border-2 border-border/70"
                                >
                                  <img
                                    src={attPref.url}
                                    alt={attPref.name}
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                  />
                                  <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                                    <Maximize className="h-6 w-6 text-white drop-shadow" />
                                  </span>
                                </button>
                              ) : (
                                <AttThumb att={attPref} />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold">{attPref.name}</p>
                                <p className="text-[10px] text-muted-foreground">{bytes(attPref.size)}</p>
                              </div>
                              {attPref.type === "image" && (
                                <button
                                  onClick={() => setPreview(attPref)}
                                  aria-label="پیش‌نمایش"
                                  title="پیش‌نمایش"
                                  className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
                                >
                                  <Maximize className="h-4 w-4" />
                                </button>
                              )}
                              <button onClick={() => setAttPref(null)} aria-label="حذف ضمیمه" className="text-muted-foreground hover:text-destructive">
                                <X className="h-4 w-4" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      )}

                      <AnimatePresence initial={false}>
                        {replyTo && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={softTween}
                            className="overflow-hidden"
                          >
                            <div className="mb-2 flex items-center gap-2 rounded-lg border-s-4 border-primary bg-primary/5 px-3 py-1.5">
                              <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[11px] font-bold text-primary">
                                  در پاسخ به {isMineMsg(replyTo, me?.role) ? "خودتان" : partner?.name ?? "پیام"}
                                </span>
                                <span dir="auto" className="block truncate text-xs text-muted-foreground [unicode-bidi:plaintext]">
                                  {quotePreview(replyTo)}
                                </span>
                              </span>
                              <button onClick={() => setReplyTo(null)} aria-label="لغو پاسخ" className="text-muted-foreground transition-colors hover:text-destructive">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {recUrl ? (
                        <VoiceRecPreview
                          url={recUrl}
                          dur={recDur}
                          sending={sending || uploading}
                          onCancel={cancelVoicePreview}
                          onSend={() => void sendVoice()}
                        />
                      ) : (
                        <>
                      <div className="relative">
                        <AnimatePresence initial={false}>
                          {emojiOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={softTween}
                              className="overflow-hidden"
                            >
                              <div className="mb-2 grid w-full grid-cols-8 gap-1 rounded-2xl border border-white/60 bg-white/75 p-2 shadow-soft backdrop-blur-xl dark:border-white/15 dark:bg-[#1a1e33]/80">
                                <div className="col-span-8 mb-1 flex items-center justify-between px-1">
                                  <span className="text-[10px] font-extrabold text-muted-foreground">ایموجی</span>
                                  <button onClick={() => setEmojiOpen(false)} aria-label="بستن" className="text-muted-foreground transition-colors hover:text-destructive">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                {EMOJIS.map((e) => (
                                  <button
                                    key={e}
                                    onClick={() => {
                                      if (draft.length + e.length > MAX_LEN) return;
                                      setDraft((d) => d + e);
                                      signalTyping();
                                    }}
                                    className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-primary/10 active:scale-90"
                                    aria-label={e}
                                  >
                                    <AppleEmoji emoji={e} size={22} />
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <div className="flex items-center gap-1.5 rounded-xl border-2 border-border/70 bg-card/85 p-1.5 shadow-soft transition-colors focus-within:border-primary/50 dark:border-border/70">
                        {draft.trim() || attPref ? (
                          <Button
                            onClick={() => send()}
                            disabled={sending || uploading || atLimit}
                            className="h-10 w-10 shrink-0 rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-90"
                            aria-label="ارسال"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-10 w-10 shrink-0 rounded-xl transition-colors",
                              recording ? "bg-destructive/15 text-destructive" : "text-muted-foreground"
                            )}
                            onClick={toggleMic}
                            disabled={uploading || sending}
                            aria-label="پیام صوتی"
                          >
                            <Mic className="h-4 w-4 rtl:-scale-x-100" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground" onClick={pickFile} disabled={uploading || sending || recording} aria-label="پیوست فایل">
                          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <div className="min-w-0 flex-1">
                          <AutoTextarea
                            inputRef={taRef}
                            value={draft}
                            onChange={(v) => {
                              setDraft(v);
                              if (v.trim()) signalTyping();
                            }}
                            onSend={() => send()}
                            placeholder="پیام خود را بنویسید…"
                            disabled={sending || uploading}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn("h-10 w-10 shrink-0 rounded-xl", emojiOpen ? "bg-primary/10 text-primary" : "text-muted-foreground")}
                          onClick={() => setEmojiOpen((o) => !o)}
                          disabled={sending || recording}
                          aria-label="ایموجی"
                        >
                          <Smile className="h-4 w-4" />
                        </Button>
                      </div>
                      </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json"
        className="hidden"
        onChange={onFile}
      />

      <AnimatePresence>
        {preview && (
          <motion.div
            key="img-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={softTween}
            onClick={() => setPreview(null)}
            className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-black/85 p-4 backdrop-blur-2xl"
          >
            <div className="pointer-events-auto flex w-full max-w-2xl items-center justify-between gap-3">
              {preview.type === "image" ? (
                <p className="min-w-0 truncate text-sm font-bold text-white" dir="auto">
                  {preview.name}
                </p>
              ) : (
                <span />
              )}
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white hover:text-black"
                  aria-label="باز کردن در تب جدید"
                  title="باز کردن در تب جدید"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <a
                  href={preview.url}
                  download={preview.name}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white hover:text-black"
                  aria-label="دانلود"
                  title="دانلود"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  onClick={() => setPreview(null)}
                  aria-label="بستن"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {preview.type === "image" ? (
              <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                <ZoomableImg key={preview.url} src={preview.url} alt={preview.name} />
              </div>
            ) : (
              <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                <video src={preview.url} controls autoPlay className="max-h-[72vh] max-w-[92vw] rounded-2xl" />
              </div>
            )}
            <p className="text-xs text-white/60">{bytes(preview.size)}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notif && (
          <motion.button
            key={notif.id}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={softSpring}
            onClick={() => {
              setActive(notif.partner);
              setOpen(true);
              setNotif(null);
            }}
            className="fixed bottom-24 start-5 end-5 z-[64] flex max-w-full items-center gap-2.5 rounded-2xl border-2 border-white/50 bg-card/85 p-2.5 text-right shadow-offset backdrop-blur-2xl sm:end-auto sm:max-w-[300px]"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/15">
              <MessageSquare className="h-4 w-4 text-accent" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-extrabold">{notif.name}</span>
              <span dir="auto" className="block truncate text-[11px] text-muted-foreground">
                {notif.body}
              </span>
            </span>
            <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
          </motion.button>
        )}
      </AnimatePresence>

      {me && !open && (
        <div className="fixed bottom-5 start-5 z-[64]">
          <div className="relative">
            {unreadTotal > 0 && (
              <span className="pointer-events-none absolute -inset-1 -z-10 animate-ping rounded-2xl bg-accent/40" aria-hidden />
            )}
            <motion.button
              initial={{ scale: 0, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={softSpring}
              onClick={() => setOpen(true)}
              aria-label="گفتگوها"
              className="press relative grid h-14 w-14 place-items-center rounded-2xl shadow-offset transition-colors bg-gradient-to-tr from-primary to-accent text-primary-foreground"
            >
              <MessageSquare className="h-6 w-6" />
              {unreadTotal > 0 && (
                <span className="pointer-events-none absolute -start-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full border-2 border-background bg-accent px-1 text-[11px] font-black text-accent-foreground">
                  {fa(unreadTotal)}
                </span>
              )}
            </motion.button>
          </div>
        </div>
      )}
    </>
  );
}

// ---- attachments -----------------------------------------------------------

function isGifName(att: ChatAttachment) {
  return /\.gif($|\?)/i.test(att.name || "") || /\.gif($|\?)/i.test(att.url || "");
}

function GifSticker({
  att,
  mine,
  time,
  pending,
  onPreview,
}: {
  att: ChatAttachment;
  mine: boolean;
  time: string;
  pending?: boolean;
  onPreview?: (att: ChatAttachment) => void;
}) {
  return (
    <div className={cn("flex max-w-full flex-col", mine ? "items-end" : "items-start")}>
      <button
        type="button"
        onClick={() => onPreview?.(att)}
        className="group relative block cursor-zoom-in overflow-hidden rounded-xl outline-none"
        aria-label={`باز کردن ${att.name}`}
      >
        <img
          src={att.url}
          alt={att.name}
          loading="lazy"
          draggable={false}
          className="max-h-44 w-auto max-w-full rounded-xl object-contain transition-transform duration-200 group-hover:scale-[1.03]"
        />
      </button>
      <span className="mt-0.5 flex items-center gap-1 px-1.5 text-[10px] leading-none">
        <span className="text-muted-foreground/80">{clock(time)}</span>
        {mine &&
          (pending ? (
            <Clock className="h-3 w-3 animate-spin text-muted-foreground/80 [animation-duration:1.6s]" />
          ) : (
            <SeenTicks read />
          ))}
      </span>
    </div>
  );
}

function MediaOnly({
  att,
  mine,
  time,
  onPreview,
}: {
  att: ChatAttachment;
  mine: boolean;
  time: string;
  onPreview?: (att: ChatAttachment) => void;
}) {
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    []
  );
  const openPreview = (a: ChatAttachment) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => onPreview?.(a), 230);
  };
  const cancelPreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
  };
  const corner = mine ? "end-1.5 bottom-1.5" : "start-1.5 bottom-1.5";
  const chip = (
    <span className={cn("absolute bottom-1.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm", corner)}>
      {clock(time)}
    </span>
  );
  if (att.type === "image") {
    return (
      <button
        type="button"
        onClick={() => openPreview(att)}
        onDoubleClick={cancelPreview}
        className="relative block w-full cursor-zoom-in"
        aria-label={`باز کردن ${att.name}`}
      >
        <img src={att.url} alt={att.name} loading="lazy" className="max-h-72 w-full object-cover" />
        {chip}
      </button>
    );
  }
  if (att.type === "video") {
    return (
      <div className="relative overflow-hidden">
        <ChatVideoPlayer att={att} onPreview={() => onPreview?.(att)} />
        <span className="pointer-events-none absolute end-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
          {clock(time)}
        </span>
      </div>
    );
  }
  if (att.type === "audio") {
    return (
      <div className="px-3 py-2">
        <VoicePlayer att={att} mine={mine} />
        <span className={cn("mt-1 flex items-center gap-1 text-[10px] leading-none", mine ? "justify-end" : "justify-start")}>
          <span className={cn("opacity-75", mine ? "text-primary-foreground/70" : "text-muted-foreground/70")}>{clock(time)}</span>
          {mine && <SeenTicks read />}
        </span>
      </div>
    );
  }
  return (
    <div className="px-3 py-2">
      <a
        href={att.url}
        target="_blank"
        rel="noreferrer"
        onDoubleClick={(e) => e.preventDefault()}
        className={cn("flex items-center gap-2 rounded-xl bg-background/50 px-3 py-2", !mine && "border border-border/50")}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15">
          <FileText className="h-4 w-4 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold" dir="auto">{att.name}</span>
          <span className="block text-[10px] text-muted-foreground">{bytes(att.size)}</span>
        </span>
        <Download className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      </a>
    </div>
  );
}

function AttachmentView({
  att,
  mine,
  time,
  onPreview,
}: {
  att: ChatAttachment;
  mine: boolean;
  time: string;
  onPreview?: (att: ChatAttachment) => void;
}) {
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    []
  );
  const openPreview = (a: ChatAttachment) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => onPreview?.(a), 230);
  };
  const cancelPreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
  };
  if (att.type === "image") {
    return (
      <div className={cn("relative -m-3.5 mb-1.5 overflow-hidden rounded-t-2xl", mine ? "rounded-l-2xl" : "rounded-r-2xl")}>
        <button
          type="button"
          onClick={() => openPreview(att)}
          onDoubleClick={cancelPreview}
          className="block w-full cursor-zoom-in"
          aria-label={`باز کردن ${att.name}`}
        >
          <img src={att.url} alt={att.name} loading="lazy" className="max-h-56 w-full object-cover" />
        </button>
        <span className="absolute bottom-1.5 end-1.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {clock(time)}
        </span>
      </div>
    );
  }
  if (att.type === "video") {
    return (
      <div className="relative">
        <ChatVideoPlayer att={att} onPreview={() => onPreview?.(att)} />
        <span className="pointer-events-none absolute end-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
          {clock(time)}
        </span>
      </div>
    );
  }
  if (att.type === "audio") {
    return (
      <div className="mb-1">
        <VoicePlayer att={att} mine={mine} />
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[10px] leading-none",
            mine ? "justify-end" : "justify-start"
          )}
        >
          <span className={mine ? "text-primary-foreground/70" : "text-muted-foreground/70"}>{clock(time)}</span>
          {mine && <SeenTicks read />}
        </div>
      </div>
    );
  }
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noreferrer"
      onDoubleClick={(e) => e.preventDefault()}
      className={cn(
        "mb-0.5 flex items-center gap-2 rounded-xl bg-background/50 px-3 py-2",
        !mine && "border border-border/50"
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15">
        <FileText className="h-4 w-4 text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold" dir="auto">
          {att.name}
        </span>
        <span className="block text-[10px] text-muted-foreground">{bytes(att.size)}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </a>
  );
}

let activeVoice: HTMLAudioElement | null = null;

function VoiceRecPreview({
  url,
  dur,
  sending,
  onCancel,
  onSend,
}: {
  url: string;
  dur: number;
  sending: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let ctx: AudioContext | null = null;
    let cleanup = false;
    const a = new Audio(url);
    audioRef.current = a;
    const onTime = () => setCur(a.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setCur(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (cleanup) return;
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        ctx.decodeAudioData(
          buf,
          (audio) => {
            if (cleanup) return;
            peaksRef.current = computePeaks(audio, 80);
            setReady(true);
          },
          () => {
            if (!cleanup) setReady(true);
          }
        );
      })
      .catch(() => {
        if (!cleanup) setReady(true);
      });
    return () => {
      cleanup = true;
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      void ctx?.close().catch(() => undefined);
    };
  }, [url]);

  useEffect(() => {
    drawWave(canvasRef.current, peaksRef.current, cur, dur);
  }, [cur, dur, ready]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => undefined);
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const seekFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = audioRef.current;
    const cv = canvasRef.current;
    if (!a || !cv || dur <= 0) return;
    const rect = cv.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * dur;
    setCur(a.currentTime);
  };

  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/80 bg-white/60 px-3 py-2 shadow-[0_4px_16px_-8px_rgba(42,39,69,0.3)] backdrop-blur-sm dark:border-white/15 dark:bg-white/10">
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label="حذف پیش‌نمایش"
          className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          onClick={onSend}
          disabled={sending}
          aria-label="ارسال پیام صوتی"
          className="h-9 w-9 rounded-xl bg-primary px-0 text-primary-foreground transition-all hover:bg-primary/90 active:scale-90"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-bold text-muted-foreground/70">{playing ? "در حال پخش…" : ""}</span>
          <span dir="ltr" className="shrink-0 text-[10px] font-bold text-muted-foreground tabular-nums">
            {clockDur(cur)} / {clockDur(dur)}
          </span>
        </div>
        <canvas
          ref={canvasRef}
          dir="ltr"
          onPointerDown={seekFromEvent}
          onPointerMove={(e) => {
            if (e.buttons & 1) seekFromEvent(e);
          }}
          className="mt-1 h-[28px] w-full cursor-pointer touch-none"
          aria-label="نوار پخش پیش‌نمایش صدا"
        />
      </div>
      <button
        onClick={toggle}
        aria-label={playing ? "توقف پخش" : "پخش پیش‌نمایش"}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-transform active:scale-90"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
    </div>
  );
}

function isSingleEmoji(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  // ZWJ sequences (e.g. family) are one grapheme — do not use string.length.
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)];
    if (parts.length !== 1) return false;
  }
  const RE =
    /^(?:(?:\p{Regional_Indicator}){2}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}\uFE0F?|\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}\uFE0F?|\uFE0F|\uFE0E)?)*)$/u;
  return RE.test(s);
}

function computePeaks(audio: AudioBuffer, buckets: number): number[] {
  const ch = audio.length > 0 ? audio.getChannelData(0) : new Float32Array(0);
  const step = Math.max(1, Math.floor(ch.length / buckets));
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    for (let j = i * step; j < Math.min((i + 1) * step, ch.length); j++) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    out.push(Math.min(1, max * 3.6));
  }
  return out;
}

function drawWave(
  cv: HTMLCanvasElement | null,
  peaks: number[],
  cur: number,
  dur: number
) {
  if (!cv) return;
  const px = window.devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  if (rect.width < 1) return;
  const w = rect.width;
  const h = rect.height;
  if (cv.width !== Math.round(w * px) || cv.height !== Math.round(h * px)) {
    cv.width = Math.round(w * px);
    cv.height = Math.round(h * px);
  }
  const g = cv.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, cv.width, cv.height);
  g.scale(px, px);
  const css = getComputedStyle(document.documentElement);
  const playedC = css.getPropertyValue("--color-primary").trim() || "#6d63f0";
  const n = Math.max(32, peaks.length || 32);
  const playedRatio = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
  const slot = w / n;
  const bw = Math.max(2, slot * 0.62);
  for (let i = 0; i < n; i++) {
    const pk = peaks[i] ?? 0.22 + 0.42 * Math.abs(Math.sin(i * 1.3 + 0.5));
    const bh = Math.max(3, pk * (h - 4));
    const x = i * slot + (slot - bw) / 2;
    const y = (h - bh) / 2;
    g.fillStyle = i / n <= playedRatio ? playedC : "rgba(120,122,150,0.35)";
    g.beginPath();
    g.roundRect(x, y, bw, bh, 2);
    g.fill();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function stopActiveVoice() {
  if (activeVoice) {
    const prev = activeVoice;
    activeVoice = null;
    prev.pause();
  }
}

function ChatVideoPlayer({
  att,
  onPreview,
}: {
  att: ChatAttachment;
  onPreview?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [showUI, setShowUI] = useState(false);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    v.currentTime = t;
    setCur(t);
  };

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch(() => undefined);
    }
  };

  const prog = dur > 0 ? Math.min(cur / dur, 1) : 0;

  return (
    <div
      ref={wrapRef}
      className="group/video relative"
      onMouseEnter={() => setShowUI(true)}
      onMouseLeave={() => setShowUI(false)}
    >
      <video
        ref={videoRef}
        src={att.url}
        preload="metadata"
        controls={false}
        playsInline
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onEnded={() => {
          setPlaying(false);
          setCur(0);
        }}
        className="block max-h-64 w-full bg-black object-contain"
      />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "توقف" : "پخش"}
        className={cn(
          "absolute inset-0 grid place-items-center transition-opacity duration-200",
          playing && !showUI ? "opacity-0" : "opacity-100"
        )}
      >
        <span
          className={cn(
            "grid h-14 w-14 place-items-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm transition-transform active:scale-90",
            !playing && "animate-pulse"
          )}
        >
          {buffering ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : playing ? (
            <Pause className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6 translate-x-0.5" />
          )}
        </span>
      </button>

      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          aria-label="بزرگنمایی"
          className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white opacity-0 transition-opacity backdrop-blur-sm hover:bg-black/60 group-hover/video:opacity-100"
        >
          <Maximize className="h-4 w-4" />
        </button>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-8 transition-opacity duration-200",
          showUI || buffering ? "opacity-100" : "opacity-0"
        )}
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)" }}
      >
        <div className="relative h-5 w-full cursor-pointer">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${prog * 100}%` }} />
          </div>
          <input
            type="range"
            min={0}
            max={dur || 1}
            step={0.1}
            value={Math.min(cur, dur || 0)}
            onChange={(e) => seek(+e.target.value)}
            aria-label="موقعیت ویدیو"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <div className="flex items-center gap-2 text-white">
          <button type="button" onClick={toggle} aria-label={playing ? "توقف" : "پخش"} className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-white/20">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <span className="min-w-12 text-[10px] tabular-nums text-white/90">
            {fmtDur(cur)} / {fmtDur(dur)}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.muted = !muted;
              setMuted(!muted);
            }}
            aria-label={muted ? "باز کردن صدا" : "بی‌صدا"}
            className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-white/20"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={fullscreen} aria-label="تمام‌صفحه" className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-white/20">
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function VoicePlayer({ att, mine }: { att: ChatAttachment; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bars, setBars] = useState<number[]>(() => voiceBars(att.url, 44));
  const [live, setLive] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyzeAudio(att.url)
      .then((b) => {
        if (!cancelled) setBars(b);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [att.url]);

  useEffect(() => {
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.src = att.url;
    a.preload = "metadata";
    audioRef.current = a;
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onTime = () => setCurrent(a.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
      setLive(null);
      stopPulse();
      if (activeVoice === a) activeVoice = null;
    };
    const onErr = () => {
      setDuration(0);
    };
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onErr);
    return () => {
      stopPulse();
      a.pause();
      if (activeVoice === a) activeVoice = null;
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onErr);
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.url]);

  useEffect(() => {
    return () => stopActiveVoice();
  }, []);

  const startPulse = () => {
    const lr = liveRef.current;
    if (!lr) return;
    const analyser = lr.analyser;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(freq);
      const vals: number[] = [];
      for (let i = 0; i < 44; i++) {
        const f = freq[i] / 255;
        vals.push(Math.max(0.12, Math.min(1, f * 1.5)));
      }
      setLive(vals);
      rafRef.current = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  const stopPulse = () => {
    cancelAnimationFrame(rafRef.current);
    setLive(null);
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      stopPulse();
      a.pause();
      setPlaying(false);
      return;
    }
    stopActiveVoice();
    activeVoice = a;
    if (!liveRef.current) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const src = ctx.createMediaElementSource(a);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 128;
          analyser.smoothingTimeConstant = 0.7;
          src.connect(analyser);
          analyser.connect(ctx.destination);
          liveRef.current = { ctx, analyser };
        }
      } catch {
        /* waveform peaks optional */
      }
    }
    void a.play().then(
      () => {
        setPlaying(true);
        if (liveRef.current) startPulse();
      },
      () => setPlaying(false)
    );
  };

  const seek = (v: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = v;
    setCurrent(v);
  };

  const scrubRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);
  const seekTo = (clientX: number) => {
    if (dur <= 0) return;
    const el = scrubRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    let a: HTMLAudioElement | null = null;
    try {
      a = audioRef.current;
    } catch {
      /* noop */
    }
    const v = ratio * dur;
    if (a) {
      try {
        a.currentTime = v;
      } catch {
        /* noop */
      }
    }
    setCurrent(v);
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    scrubbingRef.current = true;
    seekTo(e.clientX);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbingRef.current) seekTo(e.clientX);
  };
  const endScrub = () => {
    scrubbingRef.current = false;
  };

  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progress = dur > 0 ? Math.min(current / dur, 1) : 0;
  const shown = live ?? bars;

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-background/50 p-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "توقف" : "پخش"}
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform active:scale-90",
          mine ? "bg-primary-foreground/90 text-primary" : "bg-primary text-primary-foreground"
        )}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          ref={scrubRef}
          data-scrub
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="relative flex h-8 cursor-pointer touch-none select-none items-end gap-[3px]"
        >
          {shown.map((h, i) => {
            const isLit = playing || i / shown.length <= progress;
            return (
              <span
                key={i}
                style={{ height: `${Math.max(h * 100, 8)}%` }}
                className={cn(
                  "w-[3px] rounded-full",
                  isLit
                    ? mine
                      ? "bg-primary-foreground/90"
                      : "bg-primary"
                    : mine
                      ? "bg-primary-foreground/35"
                      : "bg-foreground/25"
                )}
              />
            );
          })}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 start-0 h-[3px] rounded-full transition-[width] duration-100 ease-linear"
            style={{
              width: `${progress * 100}%`,
              background: mine ? "var(--primary-foreground)" : "var(--primary)",
              opacity: 0.9,
            }}
          />
          {dur > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 z-10 h-3.5 w-3.5 rounded-full border-2 border-background shadow-sm"
              style={{
                background: mine ? "var(--primary-foreground)" : "var(--primary)",
                left: `calc(${(1 - progress) * 100}% - 7px)`,
                transform: "translateY(-50%)",
              }}
            />
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[10px] tabular-nums">
          <span className={mine ? "text-primary-foreground/70" : "text-muted-foreground"}>{fmtDur(current)}</span>
          <span className={mine ? "text-primary-foreground/70" : "text-muted-foreground"}>
            {fmtDur(dur)}
          </span>
        </div>
      </div>
    </div>
  );
}

function analyzeAudio(url: string): Promise<number[]> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return Promise.resolve(voiceBars(url, 44));
  const ctx = new Ctx();
  const fallback = (): number[] => {
    void ctx.close();
    return voiceBars(url, 44);
  };
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error("fetch");
      return r.arrayBuffer();
    })
    .then((buf) => ctx.decodeAudioData(buf))
    .then((audio) => {
      const data = audio.getChannelData(0);
      const n = 44;
      const seg = Math.max(1, Math.floor(data.length / n));
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        let max = 0;
        const start = i * seg;
        const end = Math.min(data.length, start + seg);
        for (let j = start; j < end; j++) {
          const v = Math.abs(data[j]);
          if (v > max) max = v;
        }
        out.push(max);
      }
      const peak = Math.max(...out, 1e-6);
      const rough = out.map((v) => Math.max(0.08, Math.min(1, (v / peak) * 1.1)));
      const smooth = rough.map((v, i) => {
        const lo = rough[Math.max(0, i - 1)] ?? v;
        const hi = rough[Math.min(n - 1, i + 1)] ?? v;
        return (lo + v * 2 + hi) / 4;
      });
      void ctx.close();
      return smooth;
    })
    .catch(() => fallback());
}

function voiceBars(seed: string, n: number) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    const r = (h >>> 0) / 4294967296;
    const env = Math.exp(-Math.pow((i / (n - 1) - 0.5) * 2.4, 2));
    bars.push(Math.max(0.12, Math.min(1, (0.35 + r * 0.65) * (0.35 + env * 0.65))));
  }
  return bars;
}

function fmtDur(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${fa(m)}:${fa(s).padStart(2, "۰")}`;
}

function ZoomableImg({ src, alt }: { src: string; alt?: string }) {
  const [scale, setScale] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const scaleRef = useRef(1);

  const clampScale = (s: number) => Math.min(6, Math.max(1, s));
  const setSc = (s: number) => {
    const v = clampScale(s);
    scaleRef.current = v;
    setScale(v);
  };

  useEffect(() => {
    setSc(1);
    setOff({ x: 0, y: 0 });
    pointers.current.clear();
    pinchRef.current = null;
    setGrabbing(false);
  }, [src]);

  const clampOff = (x: number, y: number) => {
    const el = imgRef.current;
    const w = (el?.offsetWidth ?? 0) / 2;
    const h = (el?.offsetHeight ?? 0) / 2;
    const maxX = Math.max(0, w * (scaleRef.current - 1));
    const maxY = Math.max(0, h * (scaleRef.current - 1));
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  };

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = clampScale(scaleRef.current * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
      setSc(s);
      if (s === 1) setOff({ x: 0, y: 0 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const m = pointers.current;
    m.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (m.size === 2) {
      const [a, b] = [...m.values()];
      pinchRef.current = { dist: dist(a, b), scale: scaleRef.current };
    } else if (m.size === 1 && scaleRef.current > 1) {
      setGrabbing(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const m = pointers.current;
    if (!m.has(e.pointerId)) return;
    const prev = m.get(e.pointerId)!;
    if (m.size === 2) {
      const [a, b] = [...m.values()];
      const start = pinchRef.current;
      if (start) setSc(start.scale * (dist(a, b) / start.dist));
    } else if (m.size === 1 && scaleRef.current > 1) {
      setOff((o) => clampOff(o.x + (e.clientX - prev.x), o.y + (e.clientY - prev.y)));
    }
    m.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchRef.current = null;
    if (pointers.current.size === 0) setGrabbing(false);
  };

  const toggleZoom = () => {
    if (scaleRef.current > 1) {
      setSc(1);
      setOff({ x: 0, y: 0 });
    } else {
      setSc(2.2);
    }
  };

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt ?? ""}
      draggable={false}
      onDoubleClick={(e) => {
        e.stopPropagation();
        toggleZoom();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${scale})` }}
      className={cn(
        "max-h-[72vh] max-w-[92vw] select-none touch-none rounded-2xl object-contain shadow-offset",
        scale > 1 ? (grabbing ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
      )}
    />
  );
}

function AttThumb({ att }: { att: ChatAttachment }) {
  if (att.type === "image")
    return <img src={att.url} alt={att.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />;
  if (att.type === "video")
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15">
        <Film className="h-4 w-4 text-primary" />
      </span>
    );
  if (att.type === "audio")
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15">
        <Mic className="h-4 w-4 text-primary" />
      </span>
    );
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15">
      <FileText className="h-4 w-4 text-primary" />
    </span>
  );
}

// ---- helpers ----------------------------------------------------------------

const STUDENT_SUGGESTIONS = [
  "سلام! به کمک نیاز دارم.",
  "قفل شدهام — لطفاً حسابم را فعال کنید.",
  "در آزمون گیر کردهام و راهنمایی میخواهم.",
];

const MENTOR_SUGGESTIONS = [
  "سلام! چطور میتوانم کمکتان کنم؟",
  "برای بازگشایی حساب، آزمون را دوباره امتحان کنید.",
  "به پیشرفتتان افتخار میکنم — ادامه دهید.",
];

function isMentorOf(role: string) {
  return role === "mentor" || role === "admin";
}

function roleLabel(role: string) {
  if (role === "mentor") return "منتور";
  if (role === "admin") return "ادمین";
  return "هنرجو";
}

function fa(n: number) {
  return n.toLocaleString("fa-IR");
}

function bytes(n: number) {
  if (n < 1024) return `${fa(n)} بایت`;
  if (n < 1024 * 1024) return `${fa(Math.round(n / 1024))} کیلوبایت`;
  return `${fa(Number((n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")))} مگابایت`;
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

function clockDur(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${fa(m)}:${fa(s).padStart(2, "۰")}`;
}

function dateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dateKey(iso) === dateKey(now.toISOString())) return "امروز";
  if (dateKey(iso) === dateKey(y.toISOString())) return "دیروز";
  return d.toLocaleDateString("fa-IR", { day: "numeric", month: "long" });
}

function previewOf(m: ChatMessage) {
  if (m.attachment) {
    const names: Record<string, string> = { image: "عکس", video: "ویدیو", audio: "پیام صوتی", file: m.attachment.name };
    const label = names[m.attachment.type] ?? m.attachment.name;
    return m.body ? `${m.body}` : label;
  }
  return m.body;
}

function PinnedPreview({ m }: { m: ChatMessage }) {
  const body = (m.body ?? "").trim();
  const att = m.attachment;
  const onlyEmoji = !att && !!body && isSingleEmoji(body);
  const gif = att && isGifName(att);

  if (onlyEmoji) {
    return (
      <span dir="auto" className="mt-0.5 block leading-none [unicode-bidi:plaintext]">
        <AppleEmoji emoji={body} size={28} />
      </span>
    );
  }

  if (att?.type === "image") {
    return (
      <span className="mt-0.5 flex min-w-0 items-center gap-2">
        <img
          src={att.url}
          alt=""
          className={cn(
            "shrink-0 object-cover",
            gif ? "h-9 w-9 object-contain" : "h-9 w-9 rounded-lg",
          )}
        />
        {body ? (
          <span className="line-clamp-1 text-xs text-foreground/90">{body}</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">{gif ? "GIF" : "عکس"}</span>
        )}
      </span>
    );
  }

  if (att?.type === "video") {
    return (
      <span className="mt-0.5 flex min-w-0 items-center gap-2">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-primary/15">
          <Film className="h-4 w-4 text-primary" />
        </span>
        <span className="line-clamp-1 text-xs text-foreground/90">{body || "ویدیو"}</span>
      </span>
    );
  }

  if (att?.type === "audio") {
    return (
      <span className="mt-0.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/50 bg-card/70 px-2.5 py-1 text-xs text-foreground/90">
        <Mic className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate">{body || "پیام صوتی"}</span>
      </span>
    );
  }

  if (att?.type === "file") {
    return (
      <span className="mt-0.5 inline-flex max-w-full items-center gap-1.5 rounded-xl border border-border/50 bg-card/70 px-2.5 py-1 text-xs text-foreground/90">
        <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate">{body || att.name || "فایل"}</span>
      </span>
    );
  }

  if (body) {
    return (
      <span className="mt-0.5 inline-block max-w-full truncate rounded-[14px] rounded-tr-[5px] border border-border/50 bg-card/80 px-2.5 py-1 text-xs leading-snug text-foreground/90">
        {body}
      </span>
    );
  }

  return <span className="mt-0.5 block text-xs text-muted-foreground">پیام پین‌شده</span>;
}

function toForm(file: File | Blob, mime?: string) {
  const fd = new FormData();
  const isFile = file instanceof File;
  // Prefer .weba / .m4a so audio/webm is never classified as video/webm on the server.
  // Important: check webm BEFORE "opus" — MediaRecorder often reports audio/webm;codecs=opus.
  let name: string;
  let type: string;
  if (isFile) {
    name = file.name;
    type = file.type || mimeForExt(file.name);
  } else {
    const m = (mime ?? "audio/webm").toLowerCase();
    if (m.includes("webm")) {
      name = `voice-${Date.now()}.weba`;
      type = "audio/webm";
    } else if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) {
      name = `voice-${Date.now()}.m4a`;
      type = "audio/mp4";
    } else if (m.startsWith("audio/ogg") || m === "audio/opus" || m.startsWith("audio/opus")) {
      name = `voice-${Date.now()}.ogg`;
      type = "audio/ogg";
    } else {
      name = `voice-${Date.now()}.weba`;
      type = "audio/webm";
    }
  }
  fd.append("file", new File([file], name, { type }));
  return fd;
}

function mimeForExt(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg",
    weba: "audio/webm",
    pdf: "application/pdf", zip: "application/zip", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] ?? "application/octet-stream";
}

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function SeenTicks({ read }: { read?: boolean }) {
  if (read) return <CheckCheck className="h-3.5 w-3.5 text-success" />;
  return <Check className="h-3.5 w-3.5 text-muted-foreground/60" />;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-bounce rounded-full bg-current opacity-70"
          style={{ animationDelay: `${i * 130}ms` }}
        />
      ))}
    </span>
  );
}

function AutoTextarea({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        if (typeof inputRef === "function") inputRef(el);
        else if (inputRef) (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSend();
        }
      }}
      rows={1}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={MAX_LEN}
      dir="auto"
      className="my-1 max-h-36 min-h-10 w-full resize-none bg-transparent px-1.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

type Seg = { kind: "date"; label: string } | { kind: "stack"; mine: boolean; msgs: ChatMessage[] };

function isMineMsg(m: Pick<ChatMessage, "senderRole">, role?: string): boolean {
  return !!role && m.senderRole === role;
}

function buildThread(msgs: ChatMessage[], role?: string): Seg[] {
  const out: Seg[] = [];
  let cur: ChatMessage[] = [];
  let curMine: boolean | null = null;
  msgs.forEach((m, i) => {
    const mine = isMineMsg(m, role);
    const prev = i > 0 ? msgs[i - 1] : undefined;
    const sameDay = prev && dateKey(prev.createdAt) === dateKey(m.createdAt);
    if (!sameDay) {
      if (cur.length) out.push({ kind: "stack", mine: curMine ?? false, msgs: cur });
      cur = [];
      out.push({ kind: "date", label: dateLabel(m.createdAt) });
      curMine = mine;
    } else if (mine !== curMine) {
      out.push({ kind: "stack", mine: curMine ?? false, msgs: cur });
      cur = [];
      curMine = mine;
    }
    cur.push(m);
  });
  if (cur.length) out.push({ kind: "stack", mine: curMine ?? false, msgs: cur });
  return out;
}

const EMOJIS = [
  "😀", "😂", "🥰", "😍", "😉", "😎", "🤗", "🙃",
  "🤔", "😅", "🥲", "😭", "😤", "😡", "🥳", "🤓",
  "👍", "👎", "👏", "🙏", "💪", "🤝", "❤️", "💯",
  "✨", "🔥", "🌟", "🎉", "🎯", "🚀", "📌", "✅",
];

const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "🔥", "🎉"];

function quotePreview(m: ChatMessage): string {
  if (m.body) return m.body;
  if (!m.attachment) return "پیام";
  switch (m.attachment.type) {
    case "image":
      return "📷 تصویر";
    case "video":
      return "🎬 ویدیو";
    case "audio":
      return "🎙️ پیام صوتی";
    default:
      return `📄 ${m.attachment.name}`;
  }
}

async function copyText(m: ChatMessage): Promise<void> {
  const text = m.body || quotePreview(m);
  try {
    await navigator.clipboard.writeText(text);
    toast.success("در کلیپ‌بورد کپی شد");
  } catch {
    toast.error("کپی ممکن نشد");
  }
}

function MsgActions({
  mine,
  voice,
  media,
  armed,
  pinned,
  open,
  onReact,
  onReactEmoji,
  onReply,
  onCopy,
  onPin,
  onDelete,
}: {
  mine: boolean;
  voice: boolean;
  media: boolean;
  armed: boolean;
  pinned?: boolean;
  open: boolean;
  onReact: () => void;
  onReactEmoji: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-30 translate-y-1 scale-90 opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/msg:pointer-events-auto group-hover/msg:translate-y-0 group-hover/msg:scale-100 group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:translate-y-0 group-focus-within/msg:scale-100 group-focus-within/msg:opacity-100",
        open && "pointer-events-auto translate-y-0 scale-100 opacity-100",
        mine ? "end-1" : "start-1",
        media ? "top-2" : "-top-3.5"
      )}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: 4 }}
        transition={softPop}
        className="flex items-center gap-0.5 rounded-full border border-solid border-white/80 bg-white/95 p-0.5 backdrop-blur-md dark:border-white/15 dark:bg-[#171a2e]/95"
      >
<div className="flex items-center gap-0.5">
        <div className="relative">
          <button
            onClick={onReact}
            aria-label="واکنش"
            className={cn(
              "grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/15 hover:text-accent",
              open && "bg-accent/15 text-accent"
            )}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.7, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.7, y: 6 }}
                  transition={softPop}
                  className={cn(
                    "absolute z-40 flex items-center gap-0.5",
                    media ? "top-full mt-1.5" : "bottom-full mb-1.5",
                    mine ? "end-0" : "start-0"
                  )}
                >
                  <div className="flex items-center gap-0.5 rounded-full border border-solid border-white/80 bg-white/95 p-1 backdrop-blur-md dark:border-white/15 dark:bg-[#171a2e]/95">
                    {QUICK_REACTIONS.map((em) => (
                      <motion.button
                        key={em}
                        type="button"
                        whileHover={{ scale: 1.3, rotate: -6 }}
                        whileTap={{ scale: 0.8 }}
                        onClick={() => onReactEmoji(em)}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ ...softPop, delay: 0.04 * QUICK_REACTIONS.indexOf(em) }}
                        aria-label={em}
                      >
                        <span className="grid h-6 w-6 place-items-center">
                          <AppleEmoji emoji={em} size={16} />
                        </span>
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={onReply}
            aria-label="پاسخ"
            className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onPin}
            aria-label={pinned ? "برداشتن پین" : "پین"}
            title={pinned ? "برداشتن پین" : "پین"}
            className={cn(
              "grid h-6 w-6 place-items-center rounded-full transition-colors",
              pinned
                ? "bg-gold/20 text-gold"
                : "text-muted-foreground hover:bg-gold/15 hover:text-gold",
            )}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        {!voice && (
          <button
            onClick={onCopy}
            aria-label="کپی"
            className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {mine && (
          <button
            onClick={onDelete}
            aria-label="حذف پیام"
            title={armed ? "حذف؟" : "حذف"}
            className={cn(
              "grid h-6 w-6 place-items-center rounded-full transition-colors",
              armed
                ? "bg-destructive text-destructive-foreground shadow-[0_0_0_3px_rgba(239,68,68,0.25)]"
                : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      </motion.div>
    </div>
  );
}

function ReactChips({
  reactions,
  mine,
  onReact,
}: {
  reactions: ChatReaction[];
  mine: boolean;
  onReact: (emoji: string) => void;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", mine ? "justify-end" : "justify-start")}>
      {reactions.map((r) => (
        <motion.button
          key={r.emoji}
          initial={{ opacity: 0, scale: 0.5, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={softPop}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.85 }}
          onClick={() => onReact(r.emoji)}
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none backdrop-blur-sm",
            r.mine
              ? "border-accent bg-accent/20 text-accent"
              : "border-border/70 bg-card/90 text-muted-foreground"
          )}
        >
          <AppleEmoji emoji={r.emoji} size={14} />
          {r.count > 1 && <span className="tabular-nums">{fa(r.count)}</span>}
        </motion.button>
      ))}
    </div>
  );
}

function QuoteBox({
  q,
  mine,
  partnerName,
  meRole,
}: {
  q: ChatMessage | null;
  mine: boolean;
  partnerName?: string;
  meRole?: string;
}) {
  const author = q
    ? isMineMsg(q, meRole)
      ? "شما"
      : q.senderRole === "mentor"
        ? "منتور"
        : partnerName ?? "هنرجو"
    : null;
  return (
    <div
      className={cn(
        "mb-1.5 flex max-w-full min-w-0 items-center gap-2 rounded-lg border-s-4 px-2.5 py-1.5",
        mine ? "border-white/80 bg-white/15" : "border-primary/50 bg-accent/10"
      )}
    >
      <CornerDownLeft className={cn("h-3.5 w-3.5 shrink-0", mine ? "text-primary-foreground/80" : "text-accent")} />
      <div className="min-w-0 flex-1">
        <span className={cn("block text-[10px] font-black leading-tight", mine ? "text-primary-foreground" : "text-accent")}>
          {author ?? "پیام قبلی"}
        </span>
        <span dir="auto" className={cn("block truncate text-xs font-medium [unicode-bidi:plaintext]", mine ? "text-primary-foreground/90" : "text-foreground/80")}>
          {q ? quotePreview(q) : "این پیام دیگر موجود نیست"}
        </span>
      </div>
    </div>
  );
}

function HighlightBody({ text, q }: { text: string; q: string }) {
  const qn = normText(q).trim();
  if (!qn) return <AppleEmojiText text={text} size={18} />;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    const m = findNormMatch(text, qn, cursor);
    if (!m) break;
    if (m.at > cursor) {
      nodes.push(<AppleEmojiText key={`t${key++}`} text={text.slice(cursor, m.at)} size={18} />);
    }
    nodes.push(
      <mark
        key={key++}
        className="rounded-sm bg-accent/40 px-0.5 text-inherit ring-1 ring-accent/40"
        style={{ unicodeBidi: "plaintext" }}
      >
        <AppleEmojiText text={text.slice(m.at, Math.min(m.at + m.len, text.length))} size={18} />
      </mark>
    );
    cursor = m.at + m.len;
  }
  if (cursor < text.length) {
    nodes.push(<AppleEmojiText key={`t${key++}`} text={text.slice(cursor)} size={18} />);
  }
  return <>{nodes}</>;
}

function normText(s: string): string {
  return s
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .split("")
    .map(normChar)
    .join("")
    .toLocaleLowerCase();
}

function normChar(c: string): string {
  switch (c) {
    case "\u064A": // Arabic yeh ي
    case "\u0649": // alef maksura ى
      return "ی";
    case "\u0643": // Arabic kaf ك
      return "ک";
    case "\u0623": // أ
    case "\u0625": // إ
    case "\u0622": // آ
      return "ا";
    case "\u0629": // teh marbuta ة
      return "ه";
    case "\u0624": // waw with hamza ؤ
      return "و";
    default:
      return c;
  }
}

function findNormMatch(orig: string, qNorm: string, from: number): { at: number; len: number } | null {
  const normd: string[] = [];
  const map: number[] = [];
  for (let i = from; i < orig.length; i++) {
    const ch = orig[i];
    if (/[\u064B-\u0652\u0640]/.test(ch)) continue;
    normd.push(normChar(ch).toLocaleLowerCase());
    map.push(i);
  }
  const ni = normd.join("").indexOf(qNorm);
  if (ni < 0) return null;
  return { at: map[ni], len: qNorm.length };
}