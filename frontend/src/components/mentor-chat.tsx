"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRight,
  Bell,
  BellOff,
  Bookmark,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  CornerDownLeft,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Maximize,
  Megaphone,
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
import { api, http, getWsUrl, toUserError } from "@/lib/api";
import { apiFormProgress, downloadAllAsZip, saveRemoteFile } from "@/lib/transfer";
import { mediaObjectKey } from "@/lib/media";
import { useCachedObjectUrl } from "@/hooks/use-cached-media";
import type { ChatAttachment, ChatMessage, ChatReaction, Conversation, Mentor } from "@/lib/types";
import { useAuth } from "@/lib/auth-store";
import { cn, formatJalaliStamp } from "@/lib/utils";
import { UserAvatar, avatarPropsOf } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "@/components/providers";
import { AppleEmoji, AppleEmojiText } from "@/components/apple-emoji";
import { softPop, softSpring, softTween } from "@/lib/motion";
import { isVerifiedRole, VerifiedBadge } from "@/components/verified-badge";

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

type PeekPreview = {
  name: string;
  saved: boolean;
  partner: Conversation["partner"];
  messages: ChatMessage[];
  loading: boolean;
};

const SWIPE_ACTION_PX = 84;
const ROW_EASE = "transform 200ms cubic-bezier(0.22,1,0.36,1)";

function ConversationRow({
  c,
  rowName,
  saved,
  canRaise,
  nextPinRank,
  shiftY,
  lifting,
  settling,
  freezeMotion,
  shellH,
  onOpen,
  onRaise,
  onPinGesture,
  onArmPeek,
  onEndPeek,
  onDisarmPeek,
  heldRef,
}: {
  c: Conversation;
  rowName: string;
  saved: boolean;
  canRaise: boolean;
  nextPinRank: number;
  shiftY: number;
  lifting: boolean;
  settling: boolean;
  freezeMotion: boolean;
  shellH: number;
  onOpen: () => void;
  onRaise?: () => void;
  onPinGesture?: (phase: "start" | "move" | "end" | "cancel", clientY: number) => void;
  onArmPeek: () => () => void;
  onEndPeek: () => void;
  onDisarmPeek: () => void;
  heldRef: { current: boolean };
}) {
  const qc = useQueryClient();
  const pinGestureRef = useRef(onPinGesture);
  pinGestureRef.current = onPinGesture;
  const showPin = !saved;
  const showArchive = !saved;
  const showMute = !saved;
  const actionCount =
    (showPin ? 1 : 0) + (showArchive ? 1 : 0) + (showMute ? 1 : 0) + (canRaise && onRaise ? 1 : 0);
  const actionPx = actionCount * SWIPE_ACTION_PX;
  const revealRef = useRef(0);
  const [reveal, setReveal] = useState(0);
  const [dragging, setDragging] = useState(false);
  const skipClick = useRef(false);
  const rtlRef = useRef(true);

  useEffect(() => {
    rtlRef.current = document.documentElement.dir !== "ltr";
  }, []);

  useEffect(() => {
    setReveal((n) => {
      const next = Math.min(n, actionPx);
      revealRef.current = next;
      return next;
    });
  }, [actionPx]);

  const setShift = (n: number) => {
    const next = Math.max(0, Math.min(actionPx, n));
    revealRef.current = next;
    setReveal(next);
  };

  const savePrefs = (patch: { pinnedRank: number | null; muted: boolean; archived: boolean }) => {
    void http.put(`/api/chats/${c.partner.id}/prefs`, patch).then(() => qc.invalidateQueries({ queryKey: ["conversations"] }));
    setShift(0);
  };

  const yTransition = freezeMotion || (lifting && !settling) ? "none" : ROW_EASE;

  return (
    <div
      data-conv={c.partner.id}
      className="relative"
      style={lifting ? { height: shellH } : undefined}
    >
      <div
        className={cn(
          "rounded-[22px]",
          lifting &&
            "absolute inset-x-0 top-0 z-30 bg-white shadow-[0_16px_36px_-14px_rgba(42,39,69,0.42)] ring-1 ring-black/10 dark:bg-[#1c1b33] dark:ring-white/10",
          !lifting && shiftY !== 0 && "bg-white dark:bg-[#1c1b33]",
        )}
        style={{
          transform: `translateY(${shiftY}px)`,
          transition: yTransition,
        }}
      >
        <div className="overflow-x-hidden rounded-[22px]">
          <div
            className="flex"
            style={{
              width: `calc(100% + ${actionPx}px)`,
              transform: `translateX(${rtlRef.current ? reveal : -reveal}px)`,
              transition: dragging ? "none" : ROW_EASE,
            }}
          >
        <button
          type="button"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (skipClick.current || heldRef.current) {
              skipClick.current = false;
              heldRef.current = false;
              return;
            }
            if (revealRef.current > 0) {
              setShift(0);
              return;
            }
            onOpen();
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            onDisarmPeek();
            const pointerId = e.pointerId;
            const startX = e.clientX;
            const startY = e.clientY;
            const origin = revealRef.current;
            const handle = e.currentTarget;
            const reorderable = !!pinGestureRef.current;
            let axis: "x" | "y" | null = null;
            let moved = false;
            let reordering = false;
            const cancelTimer = onArmPeek();
            setDragging(true);
            let reorderArmed = e.pointerType !== "touch";
            const armTimer =
              reorderable && !reorderArmed
                ? window.setTimeout(() => {
                    reorderArmed = true;
                  }, 170)
                : 0;

            const finishListeners = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", up);
              window.removeEventListener("keydown", onKey);
              if (armTimer) window.clearTimeout(armTimer);
            };
            const onKey = (ev: KeyboardEvent) => {
              if (ev.key !== "Escape" || !reordering) return;
              ev.preventDefault();
              finishListeners();
              cancelTimer();
              onEndPeek();
              setDragging(false);
              pinGestureRef.current?.("cancel", startY);
              skipClick.current = true;
              reordering = false;
            };
            const move = (ev: PointerEvent) => {
              if (ev.pointerId !== pointerId) return;
              const dx = ev.clientX - startX;
              const dy = ev.clientY - startY;
              if (!axis) {
                if (Math.hypot(dx, dy) < 8) return;
                axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
                moved = true;
                if (armTimer) window.clearTimeout(armTimer);
                cancelTimer();
                onEndPeek();
                onDisarmPeek();
                if (axis === "y" && reorderable && reorderArmed && !heldRef.current) {
                  reordering = true;
                  setShift(0);
                  try {
                    handle.setPointerCapture(pointerId);
                  } catch {
                    /* window listeners still track the gesture */
                  }
                  pinGestureRef.current?.("start", startY);
                }
              }
              if (axis === "x") {
                const dir = rtlRef.current ? 1 : -1;
                setShift(origin + dx * dir);
                return;
              }
              if (!reordering) return;
              ev.preventDefault();
              pinGestureRef.current?.("move", ev.clientY);
            };
            const up = (ev: PointerEvent) => {
              if (ev.pointerId !== pointerId && ev.type !== "pointercancel") return;
              const abort = ev.type === "pointercancel";
              const didReorder = reordering;
              finishListeners();
              cancelTimer();
              const held = heldRef.current;
              onEndPeek();
              setDragging(false);
              if (didReorder) pinGestureRef.current?.(abort ? "cancel" : "end", ev.clientY);
              else if (axis === "x") setShift(revealRef.current > actionPx * 0.35 ? actionPx : 0);
              if (moved || held || didReorder) {
                skipClick.current = true;
                heldRef.current = false;
                const stop = (click: globalThis.MouseEvent) => {
                  click.preventDefault();
                  click.stopPropagation();
                  window.removeEventListener("click", stop, true);
                };
                window.addEventListener("click", stop, true);
                window.setTimeout(() => window.removeEventListener("click", stop, true), 500);
              }
            };
            window.addEventListener("pointermove", move, { passive: false });
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", up);
            window.addEventListener("keydown", onKey);
          }}
          style={{ width: `calc(100% - ${actionPx}px)`, touchAction: lifting ? "none" : undefined }}
          className={cn(
            "flex min-w-0 touch-pan-y select-none items-center gap-3 rounded-[22px] py-1.5 pe-3 ps-2 text-start text-sm transition-colors hover:bg-white/45 dark:hover:bg-white/[0.06]",
            lifting && "cursor-grabbing hover:bg-transparent dark:hover:bg-transparent",
          )}
        >
          {saved ? (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden>
              <Bookmark className="h-5 w-5" />
            </span>
          ) : (
            <div className="relative shrink-0">
              <UserAvatar name={c.partner.name} className="h-11 w-11" {...avatarPropsOf(c.partner)} />
              <span
                className={cn(
                  "absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                  c.partner.online ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1 font-bold">
                <span className="truncate">{rowName}</span>
                {!saved && isVerifiedRole(c.partner.role) && <VerifiedBadge role={c.partner.role} />}
              </p>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                {showPin && c.pinnedRank != null && <Pin className="h-3 w-3" aria-hidden />}
                {showMute && c.muted && <BellOff className="h-3 w-3" aria-hidden />}
                {c.lastMessage ? formatJalaliStamp(c.lastMessage.createdAt) : ""}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <p
                dir="auto"
                className={cn("truncate text-xs", c.unreadCount > 0 ? "font-bold text-foreground" : "text-muted-foreground")}
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
        {actionCount > 0 && (
        <div className="flex shrink-0" style={{ width: actionPx }}>
          {showPin && (
          <button
            type="button"
            aria-label={c.pinnedRank != null ? "برداشتن سنجاق" : "سنجاق"}
            onClick={() => savePrefs({ pinnedRank: c.pinnedRank == null ? nextPinRank : null, muted: c.muted, archived: c.archived })}
            style={{ width: SWIPE_ACTION_PX }}
            className="flex shrink-0 flex-col items-center justify-center gap-1 bg-gold/20 px-1 text-center text-[10px] font-extrabold leading-tight text-foreground"
          >
            {c.pinnedRank != null ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {c.pinnedRank != null ? "برداشتن" : "سنجاق"}
          </button>
          )}
          {canRaise && onRaise && (
            <button
              type="button"
              aria-label="بالا بردن"
              onClick={() => {
                onRaise();
                setShift(0);
              }}
              style={{ width: SWIPE_ACTION_PX }}
              className="flex shrink-0 flex-col items-center justify-center gap-1 bg-primary/15 px-1 text-center text-[10px] font-extrabold leading-tight text-foreground"
            >
              <ChevronUp className="h-4 w-4" />
              بالا
            </button>
          )}
          {showMute && (
            <button
              type="button"
              aria-label={c.muted ? "باصدا" : "بی‌صدا"}
              onClick={() => savePrefs({ pinnedRank: c.pinnedRank, muted: !c.muted, archived: c.archived })}
              style={{ width: SWIPE_ACTION_PX }}
              className="flex shrink-0 flex-col items-center justify-center gap-1 bg-muted px-1 text-center text-[10px] font-extrabold leading-tight text-foreground"
            >
              {c.muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              {c.muted ? "باصدا" : "بی‌صدا"}
            </button>
          )}
          {showArchive && (
          <button
            type="button"
            aria-label={c.archived ? "بازگرداندن" : "آرشیو"}
            onClick={() => savePrefs({ pinnedRank: c.pinnedRank, muted: c.muted, archived: !c.archived })}
            style={{ width: SWIPE_ACTION_PX }}
            className="flex shrink-0 flex-col items-center justify-center gap-1 bg-accent/25 px-1 text-center text-[10px] font-extrabold leading-tight text-foreground"
          >
            {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {c.archived ? "بازگرداندن" : "آرشیو"}
          </button>
          )}
        </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PeekThread({
  messages,
  role,
  saved,
  partner,
}: {
  messages: ChatMessage[];
  role?: string;
  saved: boolean;
  partner: Conversation["partner"];
}) {
  const shown = messages.slice(-16);
  const thread = buildThread(shown, role);
  if (shown.length === 0) return null;
  return (
    <div dir="ltr" className="flex h-full flex-col justify-end gap-1">
      {thread.map((seg, i) =>
        seg.kind === "date" ? (
          <div key={`d-${i}`} className="flex justify-center py-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-[10px] font-bold text-muted-foreground shadow-soft">
              <span className="h-1 w-1 rounded-full bg-primary/60" />
              {seg.label}
            </span>
          </div>
        ) : (
          <div key={`s-${i}`} className="flex w-full items-end gap-1.5">
            {!seg.mine && !saved && (
              <UserAvatar name={partner.name} className="mb-0.5 h-7 w-7 shrink-0" {...avatarPropsOf(partner)} />
            )}
            <div className={cn("flex w-full min-w-0 max-w-[min(100%,20rem)] flex-col", seg.mine ? "ml-auto items-end" : "mr-auto items-start")}>
              {seg.msgs.map((m, idx) => (
                <PeekBubble
                  key={m.id}
                  m={m}
                  mine={seg.mine}
                  last={idx === seg.msgs.length - 1}
                  messages={shown}
                  partnerName={saved ? "پیام‌های ذخیره‌شده" : partner.name}
                  role={role}
                />
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function PeekBubble({
  m,
  mine,
  last,
  messages,
  partnerName,
  role,
}: {
  m: ChatMessage;
  mine: boolean;
  last: boolean;
  messages: ChatMessage[];
  partnerName: string;
  role?: string;
}) {
  const atts = messageAttachments(m);
  const multi = atts.length > 1;
  const mediaOnly = atts.length > 0 && !m.body;
  const isGif = !multi && mediaOnly && isGifName(atts[0]);
  const onlyEmoji = !m.replyTo && atts.length === 0 && !!m.body && isSingleEmoji(m.body);
  return (
    <div className={cn("relative max-w-full min-w-0", !last && "mb-1")}>
      <div
        className={cn(
          mediaOnly && !isGif
            ? "overflow-hidden"
            : onlyEmoji || isGif
              ? "bg-transparent px-1.5 py-1"
              : "w-fit min-w-0 max-w-full px-3.5 py-2 text-sm leading-relaxed",
          !onlyEmoji &&
            !isGif &&
            (mine
              ? cn("bg-primary text-primary-foreground shadow-[0_1px_1px_rgba(0,0,0,0.12)]", last ? "rounded-[18px] rounded-tr-[6px]" : "rounded-[14px]")
              : cn(
                  "border border-border/60 bg-card shadow-[0_1px_1px_rgba(0,0,0,0.06)]",
                  last ? "rounded-[18px] rounded-tl-[6px]" : "rounded-[14px]",
                )),
        )}
      >
        {multi ? (
          <>
            <MultiAttach atts={atts} mine={mine} time={m.createdAt} edited={!!m.editedAt} read={!!m.readAt} inset={!!m.body} showTime={!m.body} />
            {m.body ? (
              <p dir="auto" className="chat-bubble-text mt-1">
                <HighlightBody text={m.body} q="" />
              </p>
            ) : null}
            {m.body && (
              <span className={cn("mt-1 flex items-center gap-1 text-[10px] leading-none", mine ? "justify-end" : "justify-start")}>
                {m.editedAt && <span className={cn("opacity-75", mine ? "text-primary-foreground" : "text-muted-foreground")}>ویرایش‌شده</span>}
                <span className={cn("opacity-75", mine ? "text-primary-foreground" : "text-muted-foreground")}>{clock(m.createdAt)}</span>
                {mine && <SeenTicks read={!!m.readAt} />}
              </span>
            )}
          </>
        ) : mediaOnly && isGif ? (
          <GifSticker att={atts[0]} mine={mine} time={m.createdAt} read={!!m.readAt} edited={!!m.editedAt} />
        ) : mediaOnly ? (
          <MediaOnly att={atts[0]} mine={mine} time={m.createdAt} edited={!!m.editedAt} read={!!m.readAt} />
        ) : onlyEmoji ? (
          <p dir="auto" className="whitespace-pre-wrap break-words leading-[1.15] [unicode-bidi:plaintext]">
            <AppleEmoji emoji={m.body!} size={54} />
          </p>
        ) : (
          <>
            {m.replyTo != null && (
              <QuoteBox q={messages.find((x) => x.id === m.replyTo) ?? null} mine={mine} partnerName={partnerName} meRole={role} />
            )}
            {m.attachment && <AttachmentView att={m.attachment} mine={mine} time={m.createdAt} />}
            {m.body ? (
              <p dir="auto" className={cn("chat-bubble-text", m.attachment && "mt-1")}>
                <HighlightBody text={m.body} q="" />
              </p>
            ) : null}
            {m.body && (
              <span className={cn("mt-1 flex items-center gap-1 text-[10px] leading-none", mine ? "justify-end" : "justify-start")}>
                {m.editedAt && <span className={cn("opacity-75", mine ? "text-primary-foreground" : "text-muted-foreground")}>ویرایش‌شده</span>}
                <span className={cn("opacity-75", mine ? "text-primary-foreground" : "text-muted-foreground")}>{clock(m.createdAt)}</span>
                {mine && <SeenTicks read={!!m.readAt} />}
              </span>
            )}
          </>
        )}
      </div>
      {!!m.reactions?.length && (
        <div className={cn("relative z-20 -mt-1.5 w-fit", mine ? "ms-auto -me-1.5" : "me-auto -ms-1.5")}>
          <ReactChips reactions={m.reactions} mine={mine} onReact={() => undefined} />
        </div>
      )}
    </div>
  );
}

export function ChatWidget() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [peek, setPeek] = useState<PeekPreview | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastAll, setBroadcastAll] = useState(true);
  const [broadcastIds, setBroadcastIds] = useState<number[]>([]);
  const [broadcastConfirm, setBroadcastConfirm] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [pinDragView, setPinDragView] = useState<{
    id: number;
    dy: number;
    to: number;
    rowH: number;
    shellH: number;
    phase: "drag" | "settle" | "commit";
  } | null>(null);
  const pinDragRef = useRef<{
    id: number;
    startY: number;
    from: number;
    rowH: number;
    shellH: number;
    to: number;
    dy: number;
    ids: number[];
    minDy: number;
    maxDy: number;
  } | null>(null);
  const pinEpoch = useRef(0);
  const pinLandTimer = useRef<number | null>(null);
  const pendingPinOrder = useRef<number[] | null>(null);
  const sendBroadcastRef = useRef<(opts?: { attachment?: ChatAttachment | null; skipConfirm?: boolean }) => Promise<void>>(async () => {});
  const peekToken = useRef(0);
  const peekArmed = useRef(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [attPref, setAttPref] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [notif, setNotif] = useState<{ id: string; partner: number; name: string; body: string } | null>(null);
  const [preview, setPreview] = useState<ChatAttachment | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [jumpDown, setJumpDown] = useState(false);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [historyAnchor, setHistoryAnchor] = useState<number | null>(null);
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editAdds, setEditAdds] = useState<ChatAttachment[]>([]);
  const [editRemoved, setEditRemoved] = useState<number[]>([]);
  const [editReplacements, setEditReplacements] = useState<Record<number, ChatAttachment>>({});
  const [editBusy, setEditBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);
  const editPick = useRef<{ mode: "add" | "replace"; index: number }>({ mode: "add", index: 0 });
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

  const convQuery = useQuery({
        queryKey: ["conversations", showArchived, me?.id],
        queryFn: async () => {
          type ConvPayload = { conversations: Conversation[]; mutedAll?: boolean };
          const data = await http.get<ConvPayload>(
            `/api/chats/conversations${showArchived ? "?archived=1" : ""}`,
          );
          const meId = me?.id;
          if (meId == null) return data;
          const rest = data.conversations.filter((c) => c.partner.id !== meId);
          if (showArchived) return { ...data, conversations: rest };
          let saved = data.conversations.find((c) => c.partner.id === meId);
          if (!saved?.lastMessage) {
            try {
              const archived = await http.get<ConvPayload>("/api/chats/conversations?archived=1");
              const rescued = archived.conversations.find((c) => c.partner.id === meId);
              if (rescued) saved = rescued;
            } catch {
              /* inbox row still stands in for saved messages */
            }
          }
          if (!saved) return { ...data, conversations: rest };
          return { ...data, conversations: [{ ...saved, archived: false }, ...rest] };
        },
        refetchInterval: 20_000,
      });
  const convData = convQuery.data;
  const convLoading = convQuery.isPending;
  const conversations = useMemo(() => {
    const list = convData?.conversations ?? [];
    const meId = me?.id;
    if (meId == null) return list;
    const saved = list.find((c) => c.partner.id === meId);
    const rest = list.filter((c) => c.partner.id !== meId);
    if (showArchived || !saved) return rest;
    return [{ ...saved, archived: false }, ...rest];
  }, [convData?.conversations, showArchived, me?.id]);
  convRef.current = conversations;
  const unreadTotal = useMemo(
    () => conversations.reduce((n, c) => n + (c.unreadCount > 0 ? c.unreadCount : 0), 0),
    [conversations]
  );

  const { data: loveList } = useQuery({
    queryKey: ["mentors"],
    queryFn: () => http.get<{ mentors: Mentor[]; total: number }>("/api/mentors?page=1&pageSize=50"),
    enabled: !active && open,
  });

  const messagesQuery = useQuery({
    queryKey: ["chat", active],
    queryFn: () =>
      http.get<{ messages: ChatMessage[]; hasMore: boolean; pinned?: ChatMessage[] }>(
        `/api/chats/${active}/messages`,
      ),
    enabled: !!active,
    refetchInterval: active ? 5000 : false,
  });
  const messages = messagesQuery.data;
  const messagesLoading = !!active && messagesQuery.isPending;

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
          (!!m.body && normText(m.body).includes(q0)) ||
          messageAttachments(m).some((a) => !!a.name && normText(a.name).includes(q0))
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
    setHistoryAnchor(id);
  }, [matchIdx, msgSearchOpen, matchCount, matchIds]);

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

  const closeEdit = () => {
    setEditingId(null);
    setEditDraft("");
    setEditAdds([]);
    setEditRemoved([]);
    setEditReplacements({});
  };

  const saveEdit = async () => {
    if (!active || editingId == null || editBusy) return;
    const current = msgs.find((m) => m.id === editingId);
    const original = current ? messageAttachments(current) : [];
    const kept = original.filter((_, index) => !editRemoved.includes(index));
    const body = editDraft.trim();
    if (body.length > MAX_LEN) {
      toast.error("پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد");
      return;
    }
    if (!body && kept.length === 0 && editAdds.length === 0) {
      toast.error("پیام باید متن یا پیوست داشته باشد");
      return;
    }
    const replacements = Object.entries(editReplacements)
      .filter(([index]) => !editRemoved.includes(Number(index)))
      .map(([index, attachment]) => ({ index: Number(index), attachment }));
    setEditBusy(true);
    try {
      const res = await http.put<{ message: ChatMessage }>(`/api/chats/${active}/messages/${editingId}`, {
        body,
        ...(editAdds.length ? { addAttachments: editAdds } : {}),
        ...(editRemoved.length ? { removeIndexes: editRemoved } : {}),
        ...(replacements.length ? { replacements } : {}),
      });
      applyEdited(res.message);
      closeEdit();
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      toast.error(toUserError(err, "ویرایش ممکن نشد"));
    } finally {
      setEditBusy(false);
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
    setHistoryAnchor(null);
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
    setEditingId(null);
    setEditDraft("");
    setEditAdds([]);
    setEditRemoved([]);
    setEditReplacements({});
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
              if (conv && !conv.muted) {
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
        } else if (p.type === "chat_read") {
          if (p.from && activeRef.current === p.from) qc.invalidateQueries({ queryKey: ["chat", p.from] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        } else if (p.type === "typing") {
          if (p.from && activeRef.current === p.from) {
            setPartnerTyping(true);
            if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
            typingClearTimer.current = setTimeout(() => setPartnerTyping(false), 4500);
          }
        } else if (p.type === "chat_reaction") {
          if (p.from && activeRef.current === p.from) qc.invalidateQueries({ queryKey: ["chat"] });
        } else if (p.type === "chat_edit") {
          const item = p.item;
          if (item && p.from && activeRef.current === p.from) {
            qc.setQueryData<{ messages: ChatMessage[]; hasMore: boolean; pinned?: ChatMessage[] }>(
              ["chat", activeRef.current],
              (old) => {
                if (!old) return old;
                return {
                  ...old,
                  messages: old.messages.map((m) => (m.id === item.id ? item : m)),
                  pinned: old.pinned?.map((m) => (m.id === item.id ? item : m)),
                };
              },
            );
            setOlder((prev) => prev.map((m) => (m.id === item.id ? item : m)));
          }
          qc.invalidateQueries({ queryKey: ["conversations"] });
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

  const send = async (text?: string, att?: ChatAttachment | ChatAttachment[] | null) => {
    const body = (text ?? draft).trim();
    const attachments = pickedAttachments(att, attPref);
    if (!active || (!body && attachments.length === 0) || body.length > MAX_LEN || sending) return;
    setSending(true);
    const attachment = attachments[0];
    const quoteId = replyTo?.id;
    const uid = useAuth.getState().user;
    const temp: ChatMessage = {
      id: -Date.now(),
      userId: uid?.role === "mentor" ? active : (uid?.id ?? 0),
      mentorId: uid?.role === "mentor" ? (uid?.id ?? 0) : active,
      senderRole: (uid?.role ?? "student") as ChatMessage["senderRole"],
      body,
      createdAt: new Date().toISOString(),
      ...(attachment ? { attachment, attachments } : {}),
      ...(quoteId ? { replyTo: quoteId } : {}),
    };
    setDraft("");
    setAttPref([]);
    setReplyTo(null);
    setHistoryAnchor(null);
    wasNearBottomRef.current = true;
    setPending((p) => [...p, temp]);
    try {
      const res = await api<{ message: ChatMessage }>(`/api/chats/${active}/messages`, {
        method: "POST",
        body: {
          body,
          replyTo: quoteId,
          ...(attachment ? { attachment, attachments } : {}),
        },
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
      setAttPref(attachments);
      setReplyTo(replyTo);
      toast.error((err as Error).message || "ارسال ممکن نشد");
    } finally {
      setSending(false);
    }
  };

  const pickFile = () => fileRef.current?.click();
  const pickPhotos = () => photoRef.current?.click();

  const uploadSelected = async (files: File[]) => {
    const room = maxChatAttachments - attPref.length;
    if (room <= 0) {
      toast.error("در هر پیام حداکثر ۱۰ پیوست می‌توان فرستاد");
      return;
    }
    const batch = files.slice(0, room);
    if (files.length > room) toast.error("در هر پیام حداکثر ۱۰ پیوست می‌توان فرستاد");
    const accepted = batch.filter((file) => {
      if (file.size > 25 * 1024 * 1024) {
        toast.error("فایل باید کمتر از ۲۵ مگابایت باشد");
        return false;
      }
      return true;
    });
    if (!accepted.length) return;
    setUploading(true);
    setUploadPct(0);
    const added: ChatAttachment[] = [];
    try {
      for (let i = 0; i < accepted.length; i++) {
        const { attachment } = await apiFormProgress<{ attachment: ChatAttachment }>(
          "/api/chats/upload",
          toForm(accepted[i]),
          (ratio) => setUploadPct((i + ratio) / accepted.length),
        );
        added.push(attachment);
      }
      setAttPref((prev) => [...prev, ...added].slice(0, maxChatAttachments));
      setBroadcastConfirm(false);
    } catch (err) {
      if (added.length) setAttPref((prev) => [...prev, ...added].slice(0, maxChatAttachments));
      toast.error((err as Error).message || "آپلود ممکن نشد");
    } finally {
      setUploading(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length) await uploadSelected(files);
  };

  const editAccept = "image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json";

  const beginEditAdd = () => {
    if (editingId == null) return;
    const current = msgs.find((m) => m.id === editingId);
    const original = current ? messageAttachments(current) : [];
    const room = maxChatAttachments - (original.length - editRemoved.length + editAdds.length);
    if (room <= 0) {
      toast.error("در هر پیام حداکثر ۱۰ پیوست می‌توان فرستاد");
      return;
    }
    editPick.current = { mode: "add", index: 0 };
    const input = editFileRef.current;
    if (!input) return;
    input.accept = editAccept;
    input.multiple = true;
    input.click();
  };

  const beginEditReplace = (index: number) => {
    if (editingId == null) return;
    const current = msgs.find((m) => m.id === editingId);
    const att = current ? messageAttachments(current)[index] : undefined;
    if (!att) return;
    editPick.current = { mode: "replace", index };
    const input = editFileRef.current;
    if (!input) return;
    input.multiple = false;
    input.accept =
      att.type === "image" ? "image/*" : att.type === "video" ? "video/*" : att.type === "audio" ? "audio/*" : editAccept;
    input.click();
  };

  const onEditPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const pick = editPick.current;
    if (!files.length || editingId == null) return;
    const current = msgs.find((m) => m.id === editingId);
    const original = current ? messageAttachments(current) : [];
    const room = maxChatAttachments - (original.length - editRemoved.length + editAdds.length);
    const batch = pick.mode === "replace" ? files.slice(0, 1) : files.slice(0, Math.max(room, 0));
    if (pick.mode === "add" && files.length > batch.length) toast.error("در هر پیام حداکثر ۱۰ پیوست می‌توان فرستاد");
    const accepted = batch.filter((file) => {
      if (file.size > 25 * 1024 * 1024) {
        toast.error("فایل باید کمتر از ۲۵ مگابایت باشد");
        return false;
      }
      return true;
    });
    if (!accepted.length) return;
    setUploading(true);
    setUploadPct(0);
    try {
      if (pick.mode === "replace") {
        const { attachment } = await apiFormProgress<{ attachment: ChatAttachment }>(
          "/api/chats/upload",
          toForm(accepted[0]),
          setUploadPct,
        );
        const prev = original[pick.index];
        if (!prev || attachment.type !== prev.type) {
          toast.error("فایل جدید باید از همان نوع باشد");
          return;
        }
        setEditReplacements((cur) => ({ ...cur, [pick.index]: attachment }));
        setEditRemoved((cur) => cur.filter((index) => index !== pick.index));
        return;
      }
      const added: ChatAttachment[] = [];
      for (let i = 0; i < accepted.length; i++) {
        const { attachment } = await apiFormProgress<{ attachment: ChatAttachment }>(
          "/api/chats/upload",
          toForm(accepted[i]),
          (ratio) => setUploadPct((i + ratio) / accepted.length),
        );
        added.push(attachment);
      }
      setEditAdds((prev) => [...prev, ...added].slice(0, maxChatAttachments));
    } catch (err) {
      toast.error(toUserError(err, "آپلود ممکن نشد"));
    } finally {
      setUploading(false);
    }
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

  const sendVoice = async (opts?: { broadcast?: boolean }) => {
    const blob = recBlob;
    const mime = recMime;
    if (!blob || sending || uploading) return;
    if (!opts?.broadcast && !active) return;
    cancelVoicePreview();
    setUploading(true);
    setUploadPct(0);
    try {
      const { attachment } = await apiFormProgress<{ attachment: ChatAttachment }>("/api/chats/upload", toForm(blob, mime), setUploadPct);
      if (opts?.broadcast) await sendBroadcastRef.current({ attachment, skipConfirm: true });
      else await send("", attachment);
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

  useEffect(() => {
    try {
      localStorage.removeItem("pargar-chat-pin");
      sessionStorage.removeItem("pargar-chat-unlocked");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const sortedConvs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...conversations].sort((a, b) => {
      if ((a.partner.id === me?.id) !== (b.partner.id === me?.id)) return a.partner.id === me?.id ? -1 : 1;
      const ap = a.pinnedRank;
      const bp = b.pinnedRank;
      if ((ap != null) !== (bp != null)) return ap != null ? -1 : 1;
      if (ap != null && bp != null && ap !== bp) return ap - bp;
      const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return tb - ta;
    });
    if (!q) return list;
    return list.filter(
      (c) => c.partner.name.toLowerCase().includes(q) || (c.partner.id === me?.id && "پیام‌های ذخیره‌شده".includes(q)) || (c.lastMessage?.body ?? "").toLowerCase().includes(q)
    );
  }, [conversations, query, me?.id]);

  const orderedPeople = useMemo(() => {
    const list = (loveList?.mentors ?? []).filter((person) => person.id !== me?.id);
    return list.slice().sort((a, b) => {
      const onlineDelta = Number(!!b.online) - Number(!!a.online);
      if (onlineDelta !== 0) return onlineDelta;
      return a.name.localeCompare(b.name, "fa");
    });
  }, [loveList?.mentors, me?.id]);

  const pinOrderIds = useMemo(
    () => sortedConvs.filter((c) => c.pinnedRank != null && c.partner.id !== me?.id).map((c) => c.partner.id),
    [sortedConvs, me?.id],
  );

  const rowShift = (id: number) => {
    if (!pinDragView || pinDragView.phase === "commit") return 0;
    const from = pinOrderIds.indexOf(pinDragView.id);
    const index = pinOrderIds.indexOf(id);
    if (from < 0 || index < 0) return 0;
    if (id === pinDragView.id) return pinDragView.dy;
    if (from < pinDragView.to && index > from && index <= pinDragView.to) return -pinDragView.rowH;
    if (pinDragView.to < from && index >= pinDragView.to && index < from) return pinDragView.rowH;
    return 0;
  };

  const persistPinOrder = async (ids: number[]) => {
    const byId = new Map(conversations.map((c) => [c.partner.id, c]));
    qc.setQueryData<{ conversations: Conversation[] }>(["conversations", showArchived, me?.id], (old) => {
      if (!old) return old;
      const rank = new Map(ids.map((id, index) => [id, index]));
      return {
        ...old,
        conversations: old.conversations.map((c) => (rank.has(c.partner.id) ? { ...c, pinnedRank: rank.get(c.partner.id)! } : c)),
      };
    });
    try {
      await Promise.all(
        ids.map((id, index) => {
          const row = byId.get(id);
          if (!row || row.pinnedRank === index) return Promise.resolve();
          return http.put(`/api/chats/${id}/prefs`, { pinnedRank: index, muted: row.muted, archived: row.archived });
        }),
      );
    } catch (err) {
      toast.error(toUserError(err, "جابه‌جایی سنجاق ممکن نشد"));
    } finally {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    }
  };

  const raisePin = (id: number) => {
    const index = pinOrderIds.indexOf(id);
    if (index <= 0) return;
    const next = [...pinOrderIds];
    const previous = next[index - 1];
    next[index - 1] = next[index]!;
    next[index] = previous!;
    void persistPinOrder(next);
  };

  const onPinGesture = (row: Conversation, phase: "start" | "move" | "end" | "cancel", clientY: number) => {
    if (phase === "start") {
      if (pinLandTimer.current != null || pendingPinOrder.current) {
        if (pinLandTimer.current != null) {
          window.clearTimeout(pinLandTimer.current);
          pinLandTimer.current = null;
        }
        pinEpoch.current += 1;
        const pending = pendingPinOrder.current;
        pendingPinOrder.current = null;
        if (pending) void persistPinOrder(pending);
        setPinDragView(null);
        return;
      }
      const ids = pinOrderIds;
      const from = ids.indexOf(row.partner.id);
      if (from < 0) return;
      const el = document.querySelector(`[data-conv="${row.partner.id}"]`) as HTMLElement | null;
      const rect = el?.getBoundingClientRect();
      const shellH = el?.offsetHeight || Math.round(rect?.height ?? 64) || 64;
      let rowH = shellH + 2;
      if (el && rect) {
        const next = el.nextElementSibling as HTMLElement | null;
        if (next) rowH = Math.max(shellH, next.getBoundingClientRect().top - rect.top);
        else {
          const prev = el.previousElementSibling as HTMLElement | null;
          if (prev) rowH = Math.max(shellH, rect.top - prev.getBoundingClientRect().top);
        }
      }
      const list = el?.closest(".chat-scroll") as HTMLElement | null;
      const listRect = list?.getBoundingClientRect();
      const minDy = rect && listRect ? Math.min(0, listRect.top + 2 - rect.top) : -2000;
      const maxDy = rect && listRect ? Math.max(0, listRect.bottom - 2 - rect.bottom) : 2000;
      pinDragRef.current = { id: row.partner.id, startY: clientY, from, rowH, shellH, to: from, dy: 0, ids, minDy, maxDy };
      setPinDragView({ id: row.partner.id, dy: 0, to: from, rowH, shellH, phase: "drag" });
      return;
    }
    const drag = pinDragRef.current;
    if (!drag || drag.id !== row.partner.id) return;
    if (phase === "move") {
      const dy = Math.max(drag.minDy, Math.min(drag.maxDy, clientY - drag.startY));
      const slots = Math.round(dy / drag.rowH);
      const to = Math.max(0, Math.min(drag.ids.length - 1, drag.from + slots));
      drag.to = to;
      drag.dy = dy;
      setPinDragView({ id: drag.id, dy, to, rowH: drag.rowH, shellH: drag.shellH, phase: "drag" });
      return;
    }
    pinDragRef.current = null;
    const shouldCommit = phase === "end" && drag.to !== drag.from;
    const epoch = ++pinEpoch.current;
    const targetDy = shouldCommit ? (drag.to - drag.from) * drag.rowH : 0;
    const targetTo = shouldCommit ? drag.to : drag.from;
    const nextOrder = (() => {
      if (!shouldCommit) return null;
      const next = [...drag.ids];
      const [moved] = next.splice(drag.from, 1);
      if (moved == null) return null;
      next.splice(drag.to, 0, moved);
      return next;
    })();
    const land = () => {
      if (pinEpoch.current !== epoch) return;
      pinLandTimer.current = null;
      pendingPinOrder.current = null;
      if (nextOrder) void persistPinOrder(nextOrder);
      setPinDragView({ id: drag.id, dy: 0, to: drag.from, rowH: drag.rowH, shellH: drag.shellH, phase: "commit" });
      requestAnimationFrame(() => {
        if (pinEpoch.current !== epoch) return;
        setPinDragView((cur) => (cur?.phase === "commit" ? null : cur));
      });
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || Math.abs(drag.dy - targetDy) < 0.5) {
      land();
      return;
    }
    pendingPinOrder.current = nextOrder;
    setPinDragView({ id: drag.id, dy: drag.dy, to: targetTo, rowH: drag.rowH, shellH: drag.shellH, phase: "settle" });
    requestAnimationFrame(() => {
      if (pinEpoch.current !== epoch) return;
      setPinDragView((cur) => (cur && cur.phase === "settle" && cur.id === drag.id ? { ...cur, dy: targetDy } : cur));
      pinLandTimer.current = window.setTimeout(land, 240);
    });
  };

  const CHAT_PAGE = 40;
  const view = useMemo(() => {
    if (!msgs.length) return { items: msgs, start: 0, end: 0 };
    let end = msgs.length;
    if (historyAnchor != null) {
      const idx = msgs.findIndex((m) => m.id === historyAnchor);
      if (idx >= 0) end = idx + 1;
    }
    const start = Math.max(0, end - CHAT_PAGE);
    return { items: msgs.slice(start, end), start, end };
  }, [msgs, historyAnchor]);
  const thread = useMemo(() => buildThread(view.items, me?.role), [view.items, me?.role]);

  useEffect(() => {
    if (!msgSearchOpen || !matchCount) return;
    const id = matchIds[matchIdx];
    if (id == null) return;
    const el = threadRef.current?.querySelector(`[data-mid="${id}"]`);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [matchIdx, msgSearchOpen, matchCount, matchIds, view.items]);

  const showEarlier = async () => {
    const first = view.items[0];
    if (!first || loadingOlder) return;
    wasNearBottomRef.current = false;
    suppressAutoScrollRef.current = true;
    if (view.start > 0) {
      setHistoryAnchor(first.id);
      requestAnimationFrame(() => {
        threadRef.current?.querySelector(`[data-mid="${first.id}"]`)?.scrollIntoView({ block: "start" });
        suppressAutoScrollRef.current = false;
      });
      return;
    }
    if (!canLoadMore) {
      suppressAutoScrollRef.current = false;
      return;
    }
    await loadOlder();
    setHistoryAnchor(first.id);
    requestAnimationFrame(() => {
      threadRef.current?.querySelector(`[data-mid="${first.id}"]`)?.scrollIntoView({ block: "end" });
      suppressAutoScrollRef.current = false;
    });
  };

  const emptyThread = !messagesLoading && !messagesQuery.isError && msgs.length === 0;

  const openProfile = (id: number) => {
    setOpen(false);
    router.push(`/profile/${id}`);
  };

  const applyEdited = (item: ChatMessage) => {
    qc.setQueryData<{ messages: ChatMessage[]; hasMore: boolean; pinned?: ChatMessage[] }>(
      ["chat", activeRef.current],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          messages: old.messages.map((m) => (m.id === item.id ? item : m)),
          pinned: old.pinned?.map((m) => (m.id === item.id ? item : m)),
        };
      },
    );
    setOlder((prev) => prev.map((m) => (m.id === item.id ? item : m)));
  };
  const broadcastNames = useMemo(() => {
    const people = loveList?.mentors ?? [];
    return broadcastIds.flatMap((id) => {
      const person = people.find((item) => item.id === id);
      return person ? [person.name] : [];
    });
  }, [broadcastIds, loveList?.mentors]);

  const broadcastTargetIds = async () => {
    if (!broadcastAll) return broadcastIds.filter((id) => id !== me?.id);
    const ids: number[] = [];
    let page = 1;
    let total = 0;
    do {
      const res = await http.get<{ mentors: Mentor[]; total: number }>(`/api/mentors?page=${page}&pageSize=50`);
      total = res.total ?? 0;
      for (const person of res.mentors ?? []) {
        if (person.id !== me?.id) ids.push(person.id);
      }
      if ((res.mentors ?? []).length === 0 || page * 50 >= total) break;
      page += 1;
    } while (page <= 40);
    return ids;
  };

  const sendBroadcast = async (opts?: { attachment?: ChatAttachment | null; attachments?: ChatAttachment[]; skipConfirm?: boolean }) => {
    const body = draft.trim();
    const attachments = opts?.attachments ?? pickedAttachments(opts?.attachment, attPref);
    const attachment = attachments[0];
    if (broadcastBusy) return;
    if (!body && attachments.length === 0) return;
    if (broadcastAll) {
      if (!broadcastConfirm && !opts?.skipConfirm) return;
    } else if (broadcastIds.length === 0) {
      return;
    }
    setBroadcastBusy(true);
    try {
      if (!attachment) {
        await http.post("/api/chats/broadcast", { body, all: broadcastAll, userIds: broadcastAll ? [] : broadcastIds });
      } else {
        const ids = await broadcastTargetIds();
        for (let i = 0; i < ids.length; i += 4) {
          const chunk = ids.slice(i, i + 4);
          await Promise.all(
            chunk.map((id) =>
              api(`/api/chats/${id}/messages`, { method: "POST", body: { body, attachment, attachments } }),
            ),
          );
        }
      }
      setBroadcastOpen(false);
      setBroadcastConfirm(false);
      setBroadcastAll(true);
      setBroadcastIds([]);
      setDraft("");
      setAttPref([]);
      setEmojiOpen(false);
      cancelVoicePreview();
      toast.success("ارسال شد");
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      toast.error(toUserError(err, "ارسال ممکن نشد"));
    } finally {
      setBroadcastBusy(false);
    }
  };
  sendBroadcastRef.current = sendBroadcast;

  const armBroadcast = () => {
    if (broadcastBusy || uploading || sending) return;
    const ready = !!draft.trim() || attPref.length > 0 || !!recBlob;
    if (!ready) return;
    if (!broadcastAll && broadcastIds.length === 0) return;
    if (broadcastAll && !broadcastConfirm) {
      setBroadcastConfirm(true);
      return;
    }
    if (recBlob) void sendVoice({ broadcast: true });
    else void sendBroadcast();
  };

  const atLimit = draft.length >= MAX_LEN;
  const recording = !!voiceRef.current?.recorder && voiceRef.current.recorder.state === "recording";

  const firstUnread = useMemo(() => {
    if (!me) return null;
    for (const m of msgs) {
      if (!isMineMsg(m, me.role) && !m.readAt) return m.id;
    }
    return null;
  }, [msgs, me]);

  const savedChat = !!partner && partner.id === me?.id;

  const disarmPeek = () => {
    peekArmed.current = false;
  };

  const endPeek = () => {
    peekToken.current += 1;
    setPeek(null);
  };

  const armPeek = (c: Conversation, rowName: string) => {
    const token = ++peekToken.current;
    const saved = c.partner.id === me?.id;
    const timer = window.setTimeout(() => {
      if (peekToken.current !== token) return;
      peekArmed.current = true;
      setPeek({ name: rowName, saved, partner: c.partner, messages: [], loading: true });
      void http
        .get<{ messages: ChatMessage[] }>(`/api/chats/${c.partner.id}/peek`)
        .then((res) => {
          if (peekToken.current !== token) return;
          setPeek({ name: rowName, saved, partner: c.partner, messages: res.messages ?? [], loading: false });
        })
        .catch(() => {
          if (peekToken.current !== token) return;
          setPeek((cur) => (cur ? { ...cur, loading: false, messages: [] } : null));
        });
    }, 480);
    return () => window.clearTimeout(timer);
  };

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
                {broadcastOpen && !active ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg"
                      aria-label="بازگشت"
                      onClick={() => {
                        setBroadcastOpen(false);
                        setBroadcastConfirm(false);
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold">پیام همگانی</p>
                    </div>
                  </>
                ) : active && partner ? (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="بازگشت" onClick={() => setActive(null)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {savedChat ? (
                      <p className="min-w-0 flex-1 truncate text-sm font-extrabold">پیام‌های ذخیره‌شده</p>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openProfile(partner.id)}
                          className="relative shrink-0 rounded-full"
                          aria-label={`پروفایل ${partner.name}`}
                        >
                          <UserAvatar name={partner.name} className="h-9 w-9" {...avatarPropsOf(partner)} />
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                              partner.online ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-muted-foreground/40"
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => openProfile(partner.id)}
                          className="min-w-0 flex-1 text-start"
                          aria-label={`پروفایل ${partner.name}`}
                        >
                          <p className="flex min-w-0 items-center gap-1 text-sm font-extrabold">
                            <span className="truncate">{partner.name}</span>
                            {isVerifiedRole(partner.role) && <VerifiedBadge role={partner.role} />}
                          </p>
                          {partnerTyping ? (
                            <p className="flex items-center gap-1 text-[11px] font-bold text-primary">
                              <TypingDots /> در حال تایپ است
                            </p>
                          ) : (
                            <p className={cn("truncate text-[11px]", partner.online ? "font-bold text-success" : "text-muted-foreground")}>
                              {presenceLabel(partner)}
                            </p>
                          )}
                        </button>
                      </>
                    )}
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
                {!active && (
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
                )}
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
                {!active && !broadcastOpen && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowArchived((value) => !value)}
                      aria-label={showArchived ? "بازگشت به گفتگوها" : "آرشیو"}
                      aria-pressed={showArchived}
                      title={showArchived ? "بازگشت به گفتگوها" : "آرشیو"}
                      className={cn(
                        "grid h-8 w-8 place-items-center rounded-lg bg-muted/60 transition-colors",
                        showArchived ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Archive className="h-4 w-4" />
                    </button>
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
                  </>
                )}
                <ThemeToggle />
              </div>

              {peek && (
                <div className="pointer-events-none absolute inset-x-3 top-16 bottom-4 z-30 flex flex-col overflow-hidden rounded-[26px] border border-white/70 bg-white/75 shadow-[0_24px_70px_-24px_rgba(42,39,69,0.45)] ring-1 ring-black/5 backdrop-blur-2xl dark:border-white/15 dark:bg-[#14172b]/90 dark:ring-white/10">
                  <div className="flex items-center gap-2 border-b border-white/50 px-3 py-2.5 dark:border-white/10">
                    {peek.saved ? (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden>
                        <Bookmark className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className="relative shrink-0">
                        <UserAvatar name={peek.partner.name} className="h-8 w-8" {...avatarPropsOf(peek.partner)} />
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                            peek.partner.online ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-muted-foreground/40",
                          )}
                        />
                      </span>
                    )}
                    <p className="flex min-w-0 items-center gap-1 truncate text-sm font-extrabold">
                      <span className="truncate">{peek.name}</span>
                      {!peek.saved && isVerifiedRole(peek.partner.role) && <VerifiedBadge role={peek.partner.role} />}
                    </p>
                  </div>
                  <div className="chat-scroll min-h-0 flex-1 overflow-hidden p-3">
                    {peek.loading ? <ChatThreadSkeleton /> : <PeekThread messages={peek.messages} role={me?.role} saved={peek.saved} partner={peek.partner} />}
                  </div>
                </div>
              )}
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {!active && broadcastOpen ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-2 pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        aria-pressed={broadcastAll}
                        onClick={() => {
                          setBroadcastAll(true);
                          setBroadcastConfirm(false);
                        }}
                        className={cn(
                          "flex min-h-[4.5rem] items-center justify-between gap-2 rounded-[22px] px-4 py-4 text-start text-sm font-extrabold transition-colors",
                          broadcastAll
                            ? "bg-primary/15 text-foreground ring-2 ring-primary/45"
                            : "bg-white/40 text-foreground hover:bg-white/60 dark:bg-white/5 dark:hover:bg-white/10"
                        )}
                      >
                        همهٔ فعال‌ها
                        {broadcastAll && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                      <button
                        type="button"
                        aria-pressed={!broadcastAll}
                        onClick={() => {
                          setBroadcastAll(false);
                          setBroadcastConfirm(false);
                        }}
                        className={cn(
                          "flex min-h-[4.5rem] items-center justify-between gap-2 rounded-[22px] px-4 py-4 text-start text-sm font-extrabold transition-colors",
                          !broadcastAll
                            ? "bg-primary/15 text-foreground ring-2 ring-primary/45"
                            : "bg-white/40 text-foreground hover:bg-white/60 dark:bg-white/5 dark:hover:bg-white/10"
                        )}
                      >
                        چند نفر
                        {!broadcastAll && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    </div>
                    {!broadcastAll && (
                      <div className="space-y-1">
                        {orderedPeople.map((person) => {
                          const picked = broadcastIds.includes(person.id);
                          return (
                            <button
                              key={person.id}
                              type="button"
                              aria-pressed={picked}
                              onClick={() => {
                                setBroadcastIds((ids) => (picked ? ids.filter((id) => id !== person.id) : [...ids, person.id]));
                                setBroadcastConfirm(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start transition-colors",
                                picked ? "bg-primary/10" : "hover:bg-white/45 dark:hover:bg-white/5"
                              )}
                            >
                              <span
                                className={cn(
                                  "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                                  picked ? "border-primary bg-primary text-primary-foreground" : "border-foreground/20 bg-white/50 dark:bg-white/5"
                                )}
                              >
                                {picked && <Check className="h-3.5 w-3.5" />}
                              </span>
                              <UserAvatar name={person.name} className="h-9 w-9" {...avatarPropsOf(person)} />
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
                                  <span className="truncate">{person.name}</span>
                                  {isVerifiedRole(person.role) && <VerifiedBadge role={person.role} />}
                                </span>
                                <PresenceLine person={person} />
                              </span>
                            </button>
                          );
                        })}
                        {orderedPeople.length === 0 && (
                          <p className="px-2 py-3 text-sm text-muted-foreground">کسی برای انتخاب نیست.</p>
                        )}
                      </div>
                    )}
                    <p className="truncate text-center text-xs text-muted-foreground">{broadcastAudienceLine(broadcastAll, broadcastNames)}</p>
                    {broadcastAll && broadcastConfirm && (
                      <div className="space-y-3 rounded-[22px] bg-white/45 p-4 dark:bg-white/5">
                        <p className="text-center text-sm font-bold">برای همهٔ فعال‌ها فرستاده شود؟</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" variant="outline" size="lg" className="px-2" onClick={() => setBroadcastConfirm(false)}>
                            انصراف
                          </Button>
                          <Button
                            type="button"
                            size="lg"
                            className="px-2"
                            disabled={broadcastBusy || uploading || (!draft.trim() && attPref.length === 0 && !recBlob)}
                            onClick={armBroadcast}
                          >
                            {broadcastBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                            برای همه بفرست
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 px-2 pb-2">
                    {recording && (
                      <div className="mb-2 flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2">
                        <span className="flex-1 text-xs font-bold text-destructive tabular-nums">{clockDur(recSec)}</span>
                        <button type="button" onClick={cancelVoice} aria-label="انصراف از ضبط" className="text-destructive/70 hover:text-destructive">
                          <X className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={toggleMic} aria-label="پایان ضبط" className="text-destructive">
                          <Square className="h-4 w-4 fill-current" />
                        </button>
                      </div>
                    )}
                    <PendingAttachBar
                      atts={attPref}
                      uploading={uploading}
                      uploadPct={uploadPct}
                      captionHint={draft.trim() ? "با همین کپشن ارسال می‌شود." : "بدون کپشن هم می‌توانید بفرستید."}
                      onRemove={(index) => {
                        setAttPref((prev) => prev.filter((_, i) => i !== index));
                        setBroadcastConfirm(false);
                      }}
                      onPreview={setPreview}
                    />
                    {emojiOpen && (
                      <div className="mb-2 grid w-full grid-cols-8 gap-1 rounded-2xl border border-white/60 bg-white/75 p-2 shadow-soft backdrop-blur-xl dark:border-white/15 dark:bg-[#1a1e33]/80">
                        {EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              if (draft.length + emoji.length > MAX_LEN) return;
                              setDraft((value) => value + emoji);
                              setBroadcastConfirm(false);
                            }}
                            className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-primary/10"
                            aria-label={emoji}
                          >
                            <AppleEmoji emoji={emoji} size={22} />
                          </button>
                        ))}
                      </div>
                    )}
                    {recUrl ? (
                      <VoiceRecPreview
                        url={recUrl}
                        dur={recDur}
                        sending={broadcastBusy || uploading}
                        onCancel={() => {
                          cancelVoicePreview();
                          setBroadcastConfirm(false);
                        }}
                        onSend={armBroadcast}
                      />
                    ) : (
                      <div className="flex items-end gap-1.5 rounded-xl border-2 border-border/70 bg-card/85 p-1.5 shadow-soft">
                        {draft.trim() || attPref.length > 0 ? (
                          <Button
                            onClick={armBroadcast}
                            disabled={broadcastBusy || uploading || sending || recording || (!broadcastAll && broadcastIds.length === 0)}
                            className="h-10 w-10 shrink-0 rounded-xl bg-primary text-primary-foreground"
                            aria-label="ارسال"
                          >
                            {broadcastBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground"
                            onClick={toggleMic}
                            disabled={uploading || broadcastBusy}
                            aria-label="پیام صوتی"
                          >
                            <Mic className="h-4 w-4 rtl:-scale-x-100" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground" onClick={pickPhotos} disabled={uploading || broadcastBusy || recording} aria-label="پیوست عکس">
                          <ImageIcon className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground" onClick={pickFile} disabled={uploading || broadcastBusy || recording} aria-label="پیوست فایل">
                          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <div className="min-w-0 flex-1">
                          <AutoTextarea
                            value={draft}
                            onChange={(value) => {
                              setDraft(value.slice(0, MAX_LEN));
                              setBroadcastConfirm(false);
                            }}
                            onSend={armBroadcast}
                            placeholder={"\u200Fپیام خود را بنویسید…"}
                            disabled={broadcastBusy || uploading}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn("h-10 w-10 shrink-0 rounded-xl", emojiOpen ? "bg-primary/10 text-primary" : "text-muted-foreground")}
                          onClick={() => setEmojiOpen((open) => !open)}
                          disabled={broadcastBusy || recording}
                          aria-label="ایموجی"
                        >
                          <Smile className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                ) : !active ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="shrink-0 px-4 pb-1 pt-4">
                      <div className="relative">
                        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="جستجو در گفتگوها…"
                          dir="rtl"
                          className="h-11 w-full rounded-2xl border border-white/70 bg-white/45 ps-10 pe-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/75 focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10 dark:bg-white/5"
                        />
                      </div>
                    </div>
                    <div className="chat-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-3 pt-2">
                      {composeOpen && (
                        <div className="mb-3 rounded-2xl border-2 border-primary/20 bg-primary/5 p-3">
                          <p className="mb-2 text-xs font-bold text-muted-foreground">شروع گفتگوی جدید</p>
                          {me?.role !== "student" && (
                            <button
                              type="button"
                              onClick={() => {
                                setComposeOpen(false);
                                setBroadcastConfirm(false);
                                setBroadcastAll(true);
                                setBroadcastIds([]);
                                setDraft("");
                                setAttPref([]);
                                setBroadcastOpen(true);
                              }}
                              className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold transition-colors hover:bg-primary/10"
                            >
                              <Megaphone className="h-4 w-4 text-primary" />
                              پیام همگانی
                            </button>
                          )}
                          {orderedPeople.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setActive(m.id);
                                setComposeOpen(false);
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start text-sm transition-colors hover:bg-primary/10"
                            >
                              <UserAvatar name={m.name} className="h-8 w-8" {...avatarPropsOf(m)} />
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1 font-medium">
                                  <span className="truncate">{m.name}</span>
                                  {isVerifiedRole(m.role) && <VerifiedBadge role={m.role} />}
                                </span>
                                <PresenceLine person={m} />
                              </span>
                            </button>
                          ))}
                          {orderedPeople.length === 0 && (
                            <p className="text-xs text-muted-foreground">مخاطب مجازی برای گفتگو وجود ندارد.</p>
                          )}
                        </div>
                      )}
                      {sortedConvs.map((c) => {
                        const rowName = c.partner.id === me?.id ? "پیام‌های ذخیره‌شده" : c.partner.name;
                        const pins = sortedConvs.filter((x) => x.pinnedRank != null);
                        const pinIndex = pinOrderIds.indexOf(c.partner.id);
                        const canRaise = c.pinnedRank != null && c.partner.id !== me?.id && pinIndex > 0;
                        return (
                          <ConversationRow
                            key={c.partner.id}
                            c={c}
                            rowName={rowName}
                            saved={c.partner.id === me?.id}
                            canRaise={canRaise}
                            nextPinRank={pins.length}
                            shiftY={rowShift(c.partner.id)}
                            lifting={pinDragView?.phase !== "commit" && pinDragView?.id === c.partner.id}
                            settling={pinDragView?.phase === "settle" && pinDragView.id === c.partner.id}
                            freezeMotion={pinDragView?.phase === "commit"}
                            shellH={pinDragView?.phase !== "commit" && pinDragView?.id === c.partner.id ? pinDragView.shellH : 0}
                            onOpen={() => {
                              setActive(c.partner.id);
                              setComposeOpen(false);
                            }}
                            onRaise={canRaise ? () => raisePin(c.partner.id) : undefined}
                            onPinGesture={
                              c.pinnedRank != null && c.partner.id !== me?.id
                                ? (phase, clientY) => onPinGesture(c, phase, clientY)
                                : undefined
                            }
                            onArmPeek={() => armPeek(c, rowName)}
                            onEndPeek={endPeek}
                            onDisarmPeek={disarmPeek}
                            heldRef={peekArmed}
                          />
                        );
                      })}

                      {sortedConvs.length === 0 && conversations.length > 0 && (
                        <p className="px-1 py-3 text-center text-xs text-muted-foreground">گفتگویی یافت نشد.</p>
                      )}
                      {convLoading && conversations.length === 0 && (
                        <div className="space-y-2" aria-busy="true" aria-label="در حال بارگذاری گفتگوها">
                          {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-14 rounded-2xl" />
                          ))}
                        </div>
                      )}
                      {conversations.length === 0 && !composeOpen && !convLoading && (
                        <div className="space-y-1 p-1">
                          <p className="mb-2 text-xs font-bold text-muted-foreground">برای شروع، روی مداد بزنید</p>
                          {orderedPeople.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setActive(m.id);
                                setComposeOpen(false);
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start text-sm transition-colors hover:bg-primary/10"
                            >
                              <UserAvatar name={m.name} className="h-7 w-7" {...avatarPropsOf(m)} />
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1 font-medium">
                                  <span className="truncate">{m.name}</span>
                                  {isVerifiedRole(m.role) && <VerifiedBadge role={m.role} />}
                                </span>
                                <PresenceLine person={m} />
                              </span>
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
                          const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
                          if (files.length) void uploadSelected(files);
                        }}
                        dir="ltr"
                        className="relative z-10 h-full min-h-0 space-y-1 overflow-y-auto overscroll-contain p-3 chat-scroll"
                      >
                        {dragOver && (
                          <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
                            <p className="text-sm font-extrabold text-primary">فایل را رها کنید</p>
                          </div>
                        )}
                        {messagesLoading && <ChatThreadSkeleton />}
                        {messagesQuery.isError && !messagesLoading && (
                          <div className="mx-auto max-w-[260px] space-y-3 pt-8 text-center">
                            <p className="text-sm font-medium text-destructive">بارگذاری پیام‌ها ممکن نشد</p>
                            <button
                              type="button"
                              onClick={() => void messagesQuery.refetch()}
                              className="rounded-full border border-border px-3 py-1 text-[11px] font-bold"
                            >
                              تلاش دوباره
                            </button>
                          </div>
                        )}
                        {emptyThread && !savedChat && (
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

                        {(view.start > 0 || canLoadMore) && (
                          <div className="flex justify-center py-1.5">
                            <button
                              onClick={() => void showEarlier()}
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
                                {!seg.mine && partner && !savedChat && (
                                  <button
                                    type="button"
                                    onClick={() => openProfile(partner.id)}
                                    className="mb-0.5 shrink-0 rounded-full"
                                    aria-label={`پروفایل ${partner.name}`}
                                  >
                                    <UserAvatar name={partner.name} className="h-7 w-7" {...avatarPropsOf(partner)} />
                                  </button>
                                )}
                                <div className={cn("flex w-full min-w-0 max-w-[min(100%,20rem)] items-end gap-1 sm:max-w-[24rem]", seg.mine ? "ml-auto" : "mr-auto")}>
                                  <div className={cn("flex w-full min-w-0 max-w-full flex-col", seg.mine ? "items-end" : "items-start")}>
                                    {seg.msgs.map((m, idx) => {
                                      const isLast = idx === seg.msgs.length - 1;
                                      const atts = messageAttachments(m);
                                      const multi = atts.length > 1;
                                      const mediaOnly = atts.length > 0 && !m.body;
                                      const isPending = m.id < 0;
                                      const isGif = !multi && mediaOnly && isGifName(atts[0]);
                                      const onlyEmoji =
                                        !m.replyTo && atts.length === 0 && !!m.body && isSingleEmoji(m.body);
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
                                              mediaOnly && editingId !== m.id && !isGif
                                                ? "overflow-hidden"
                                                : onlyEmoji || isGif
                                                  ? "bg-transparent px-1.5 py-1"
                                                  : "w-fit min-w-0 max-w-full px-3.5 py-2 text-sm leading-relaxed",
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
                                            {editingId === m.id ? (
                                              <ChatEditPane
                                                message={m}
                                                mine={seg.mine}
                                                atts={atts}
                                                quote={m.replyTo ? msgs.find((x) => x.id === m.replyTo) ?? null : null}
                                                partnerName={partner?.name}
                                                meRole={me?.role}
                                                onlyEmoji={onlyEmoji}
                                                draft={editDraft}
                                                onDraft={setEditDraft}
                                                adds={editAdds}
                                                removed={editRemoved}
                                                replacements={editReplacements}
                                                busy={editBusy || uploading}
                                                onAdd={beginEditAdd}
                                                onReplace={beginEditReplace}
                                                onClearReplace={(index) =>
                                                  setEditReplacements((cur) => {
                                                    const next = { ...cur };
                                                    delete next[index];
                                                    return next;
                                                  })
                                                }
                                                onToggleRemove={(index) =>
                                                  setEditRemoved((cur) =>
                                                    cur.includes(index) ? cur.filter((i) => i !== index) : [...cur, index],
                                                  )
                                                }
                                                onRemoveAdd={(index) => setEditAdds((cur) => cur.filter((_, i) => i !== index))}
                                                onCancel={closeEdit}
                                                onSave={() => void saveEdit()}
                                                onPreview={setPreview}
                                              />
                                            ) : multi ? (
                                              <>
                                                {m.replyTo && (
                                                  <QuoteBox
                                                    q={msgs.find((x) => x.id === m.replyTo) ?? null}
                                                    mine={seg.mine}
                                                    partnerName={partner?.name}
                                                    meRole={me?.role}
                                                  />
                                                )}
                                                <MultiAttach
                                                  atts={atts}
                                                  mine={seg.mine}
                                                  time={m.createdAt}
                                                  edited={!!m.editedAt}
                                                  read={!!m.readAt}
                                                  pending={isPending}
                                                  onPreview={setPreview}
                                                  inset={!!m.body}
                                                  showTime={!m.body}
                                                />
                                                {m.body ? (
                                                  <p dir="auto" className="chat-bubble-text mt-1">
                                                    <HighlightBody text={m.body} q={msgQuery} />
                                                  </p>
                                                ) : null}
                                                {m.body && editingId !== m.id && (
                                                  <span className={cn("mt-1 flex items-center gap-1 text-[10px] leading-none", seg.mine ? "justify-end" : "justify-start")}>
                                                    {m.editedAt && (
                                                      <span className={cn("opacity-75", seg.mine ? "text-primary-foreground" : "text-muted-foreground")}>ویرایش‌شده</span>
                                                    )}
                                                    <span className={cn("opacity-75", seg.mine ? "text-primary-foreground" : "text-muted-foreground")}>{clock(m.createdAt)}</span>
                                                    {seg.mine &&
                                                      (isPending ? (
                                                        <Clock className="h-3.5 w-3.5 animate-spin text-primary-foreground/75 [animation-duration:1.6s]" />
                                                      ) : (
                                                        <SeenTicks read={!!m.readAt} />
                                                      ))}
                                                  </span>
                                                )}
                                              </>
                                            ) : mediaOnly && isGif ? (
                                              <GifSticker
                                                att={atts[0]}
                                                mine={seg.mine}
                                                time={m.createdAt}
                                                pending={isPending}
                                                read={!!m.readAt}
                                                edited={!!m.editedAt}
                                                onPreview={setPreview}
                                              />
                                            ) : mediaOnly ? (
                                            <>
                                              <MediaOnly att={atts[0]} mine={seg.mine} time={m.createdAt} edited={!!m.editedAt} read={!!m.readAt} pending={isPending} onPreview={setPreview} />
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
                                              {m.body ? (
                                                <p
                                                  dir="auto"
                                                  className={cn("chat-bubble-text", m.attachment && "mt-1")}
                                                >
                                                  <HighlightBody text={m.body} q={msgQuery} />
                                                </p>
                                              ) : null}
                                              {m.body && editingId !== m.id && (
                                                <span
                                                  className={cn(
                                                    "mt-1 flex items-center gap-1 text-[10px] leading-none",
                                                    seg.mine ? "justify-end" : "justify-start"
                                                  )}
                                                >
                                                  {m.editedAt && (
                                                    <span className={cn("opacity-75", seg.mine ? "text-primary-foreground" : "text-muted-foreground")}>
                                                      ویرایش‌شده
                                                    </span>
                                                  )}
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
                                          {!!m.buttons?.length && !seg.mine && (
                                            <div className="mt-1 flex flex-col gap-1">
                                              {m.buttons.map((b) => (
                                                <button
                                                  key={b.text}
                                                  type="button"
                                                  className="rounded-lg border px-2 py-1 text-center text-xs font-bold"
                                                  onClick={() => {
                                                    if (!active) return;
                                                    void http
                                                      .post(`/api/chats/${active}/messages`, { body: b.text })
                                                      .then(() => qc.invalidateQueries({ queryKey: ["chat", active] }));
                                                  }}
                                                >
                                                  {b.text}
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                          {editingId !== m.id && (
                                          <MsgActions
                                            mine={seg.mine}
                                            voice={atts.length === 1 && atts[0].type === "audio"}
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
                                            onSave={() => {
                                              void http.post("/api/me/saved", {
                                                body: m.body,
                                                attachmentUrl: m.attachment?.url ?? "",
                                                attachmentType: m.attachment?.type ?? "",
                                                attachmentName: m.attachment?.name ?? "",
                                              }).then(() => {
                                                toast.success("در پیام‌های ذخیره‌شده قرار گرفت");
                                                qc.invalidateQueries({ queryKey: ["conversations"] });
                                                if (me) qc.invalidateQueries({ queryKey: ["chat", me.id] });
                                              });
                                            }}
                                            onCopy={() => copyText(m)}
                                            onPin={() => void togglePin(m)}
                                            onEdit={
                                              seg.mine && m.id > 0 && (atts.length > 0 || !!m.body)
                                                ? () => {
                                                    setReactId(null);
                                                    setEditingId(m.id);
                                                    setEditDraft(m.body ?? "");
                                                    setEditAdds([]);
                                                    setEditRemoved([]);
                                                    setEditReplacements({});
                                                  }
                                                : undefined
                                            }
                                            editLabel="ویرایش پیام"
                                            onDelete={() => armDelete(m.id)}
                                          />
                                          )}
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
                        {(jumpDown || (historyAnchor != null && view.end < msgs.length)) && (
                          <motion.button
                            key="jump-down"
                            initial={{ opacity: 0, y: 10, scale: 0.85 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.85 }}
                            transition={softSpring}
                            onClick={() => {
                              setHistoryAnchor(null);
                              wasNearBottomRef.current = true;
                              setJumpDown(false);
                              requestAnimationFrame(() => {
                                const el = threadRef.current;
                                if (el) el.scrollTop = el.scrollHeight;
                              });
                            }}
                            aria-label="برو به آخرین پیام"
                            className="absolute bottom-3 end-3 z-30 grid h-9 w-9 place-items-center rounded-full border-2 border-primary/50 bg-card/95 text-primary shadow-soft ring-2 ring-white/40 backdrop-blur-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground active:scale-90 dark:bg-[#1a1e33]/95 dark:ring-black/30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>

                    {partnerTyping && !savedChat && (
                      <div className="flex shrink-0 items-center gap-2 border-t border-border/40 bg-background/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                        <TypingDots />
                        {partner?.name} در حال تایپ است…
                      </div>
                    )}

                    {emptyThread && !savedChat && (
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

                      <PendingAttachBar
                        atts={attPref}
                        uploading={uploading}
                        uploadPct={uploadPct}
                        largePreview
                        captionHint={draft.trim() ? "با همین کپشن ارسال می‌شود." : "بدون کپشن هم می‌توانید بفرستید، یا پایین متن بنویسید."}
                        onRemove={(index) => setAttPref((prev) => prev.filter((_, i) => i !== index))}
                        onPreview={setPreview}
                      />

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
                        <div className="flex items-end gap-1.5 rounded-xl border-2 border-border/70 bg-card/85 p-1.5 shadow-soft transition-colors focus-within:border-primary/50 dark:border-border/70">
                        {draft.trim() || attPref.length > 0 ? (
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
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground" onClick={pickPhotos} disabled={uploading || sending || recording} aria-label="پیوست عکس">
                          <ImageIcon className="h-4 w-4" />
                        </Button>
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
                            placeholder={"\u200Fپیام خود را بنویسید…"}
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
        ref={photoRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFile}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json"
        multiple
        className="hidden"
        onChange={onFile}
      />
      <input ref={editFileRef} type="file" className="hidden" onChange={(e) => void onEditPick(e)} />

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
                <PreviewSaveButton url={preview.url} name={preview.name} cache={preview.type !== "video"} />
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

const maxChatAttachments = 10;

function messageAttachments(m: ChatMessage): ChatAttachment[] {
  if (m.attachments && m.attachments.length > 0) return m.attachments;
  return m.attachment ? [m.attachment] : [];
}

function pickedAttachments(
  att: ChatAttachment | ChatAttachment[] | null | undefined,
  pref: ChatAttachment[],
): ChatAttachment[] {
  if (att === undefined) return pref;
  if (att === null) return [];
  return Array.isArray(att) ? att : [att];
}

function isGifName(att: ChatAttachment) {
  return /\.gif($|\?)/i.test(att.name || "") || /\.gif($|\?)/i.test(att.url || "");
}

function ChatEditPane({
  message,
  mine,
  atts,
  quote,
  partnerName,
  meRole,
  onlyEmoji,
  draft,
  onDraft,
  adds,
  removed,
  replacements,
  busy,
  onAdd,
  onReplace,
  onClearReplace,
  onToggleRemove,
  onRemoveAdd,
  onCancel,
  onSave,
  onPreview,
}: {
  message: ChatMessage;
  mine: boolean;
  atts: ChatAttachment[];
  quote: ChatMessage | null;
  partnerName?: string;
  meRole?: string;
  onlyEmoji: boolean;
  draft: string;
  onDraft: (value: string) => void;
  adds: ChatAttachment[];
  removed: number[];
  replacements: Record<number, ChatAttachment>;
  busy: boolean;
  onAdd: () => void;
  onReplace: (index: number) => void;
  onClearReplace: (index: number) => void;
  onToggleRemove: (index: number) => void;
  onRemoveAdd: (index: number) => void;
  onCancel: () => void;
  onSave: () => void;
  onPreview: (att: ChatAttachment) => void;
}) {
  return (
    <>
      {message.replyTo && (
        <QuoteBox q={quote} mine={mine} partnerName={partnerName} meRole={meRole} />
      )}
      {onlyEmoji && <AppleEmoji emoji={draft || message.body || "🙂"} size={40} />}
      {atts.length > 0 && (
        <MultiAttach
          atts={atts}
          mine={mine}
          time={message.createdAt}
          edited={!!message.editedAt}
          read={!!message.readAt}
          onPreview={onPreview}
          inset
          showTime={false}
        />
      )}
      <div className="mt-2 space-y-2">
        {atts.map((att, index) => {
          const gone = removed.includes(index);
          const next = replacements[index];
          return (
            <div key={`${att.url}-${index}`} className="flex items-center gap-1 text-[10px]">
              <span dir="auto" className={cn("min-w-0 flex-1 truncate font-bold", gone && "line-through opacity-60")}>
                {att.name}
              </span>
              {gone ? (
                <button type="button" onClick={() => onToggleRemove(index)} className="shrink-0 rounded-full px-2 py-1 font-bold text-foreground">
                  برگرداندن
                </button>
              ) : (
                <>
                  {next && (
                    <button
                      type="button"
                      onClick={() => onClearReplace(index)}
                      className="max-w-[7rem] truncate rounded-full px-2 py-1 font-bold text-foreground"
                      title="انصراف از جایگزینی"
                    >
                      با {next.name}
                    </button>
                  )}
                  <button type="button" onClick={() => onReplace(index)} className="shrink-0 rounded-full px-2 py-1 font-bold text-foreground">
                    جایگزینی
                  </button>
                  <button type="button" onClick={() => onToggleRemove(index)} className="shrink-0 rounded-full px-2 py-1 font-bold text-foreground">
                    حذف
                  </button>
                </>
              )}
            </div>
          );
        })}
        {adds.map((att, index) => (
          <div key={`${att.url}-${index}`} className="flex items-center gap-1 text-[10px]">
            <span dir="auto" className="min-w-0 flex-1 truncate font-bold">
              افزوده: {att.name}
            </span>
            <button type="button" onClick={() => onRemoveAdd(index)} className="shrink-0 rounded-full px-2 py-1 font-bold text-foreground">
              حذف
            </button>
          </div>
        ))}
        <button type="button" onClick={onAdd} disabled={busy} className="rounded-full bg-foreground/10 px-2 py-1 text-[10px] font-bold text-foreground disabled:opacity-50">
          افزودن پیوست
        </button>
        <textarea
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          dir="auto"
          rows={3}
          maxLength={MAX_LEN}
          placeholder="کپشن یا متن…"
          className="chat-composer w-full min-w-[12rem] resize-none rounded-lg bg-background px-2 py-1 text-sm text-foreground outline-none"
        />
        <div className="flex justify-end gap-1">
          <button type="button" onClick={onCancel} className="rounded-full px-2 py-1 text-[10px] font-bold text-foreground">
            انصراف
          </button>
          <button type="button" disabled={busy} onClick={onSave} className="rounded-full bg-foreground/10 px-2 py-1 text-[10px] font-bold text-foreground disabled:opacity-50">
            {busy ? "…" : "ذخیره"}
          </button>
        </div>
      </div>
    </>
  );
}

function GifSticker({
  att,
  mine,
  time,
  pending,
  read,
  edited,
  onPreview,
}: {
  att: ChatAttachment;
  mine: boolean;
  time: string;
  pending?: boolean;
  read?: boolean;
  edited?: boolean;
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
        <CachedImg
          src={att.url}
          alt={att.name}
          className="max-h-44 w-auto max-w-full rounded-xl object-contain transition-transform duration-200 group-hover:scale-[1.03]"
        />
      </button>
      <span className="mt-0.5 flex items-center gap-1 px-1.5 text-[10px] leading-none">
        {edited && <span className="text-muted-foreground/80">ویرایش‌شده</span>}
        <span className="text-muted-foreground/80">{clock(time)}</span>
        {mine &&
          (pending ? (
            <Clock className="h-3 w-3 animate-spin text-muted-foreground/80 [animation-duration:1.6s]" />
          ) : (
            <SeenTicks read={read} />
          ))}
      </span>
    </div>
  );
}

function CachedImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const shown = useCachedObjectUrl(src);
  if (!shown) {
    return <span className={cn("block animate-pulse bg-muted/50", className)} aria-hidden />;
  }
  return <img src={shown} alt={alt} draggable={false} className={className} />;
}

function FileSaveButton({ att, mine, className }: { att: ChatAttachment; mine: boolean; className?: string }) {
  const [pct, setPct] = useState<number | null>(null);
  const save = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pct !== null) return;
    setPct(0);
    try {
      await saveRemoteFile(att.url, att.name, setPct);
    } catch (err) {
      toast.error((err as Error).message || "دانلود ممکن نشد");
    } finally {
      setPct(null);
    }
  };
  return (
    <div
      className={cn(
        "relative flex w-full items-center gap-2 overflow-hidden rounded-xl bg-background/50 px-3 py-2 text-start",
        !mine && "border border-border/50",
        className,
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15">
        <FileText className="h-4 w-4 text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold" dir="auto">{att.name}</span>
        <span className="block text-[10px] text-muted-foreground">
          {pct !== null ? `در حال دانلود… ${fa(Math.round(pct * 100))}٪` : bytes(att.size)}
        </span>
      </span>
      <button
        type="button"
        onClick={(e) => void save(e)}
        disabled={pct !== null}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-70"
        aria-label="دانلود فایل"
        title="دانلود"
      >
        {pct !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </button>
      {pct !== null && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-primary/15">
          <span className="block h-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(pct * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

function PendingAttachBar({
  atts,
  uploading,
  uploadPct,
  captionHint,
  onRemove,
  onPreview,
  largePreview,
}: {
  atts: ChatAttachment[];
  uploading: boolean;
  uploadPct: number;
  captionHint: string;
  onRemove: (index: number) => void;
  onPreview: (att: ChatAttachment) => void;
  largePreview?: boolean;
}) {
  if (!uploading && atts.length === 0) return null;
  const one = atts.length === 1 ? atts[0] : null;
  return (
    <div className="relative mb-2 overflow-hidden rounded-xl border-2 border-border/70 bg-muted/40 px-3 py-2">
      {uploading && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-primary/10">
          <span className="block h-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(uploadPct * 100)}%` }} />
        </span>
      )}
      {uploading && atts.length === 0 ? (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="flex-1 text-xs font-medium text-muted-foreground">در حال آپلود… {fa(Math.round(uploadPct * 100))}٪</span>
        </div>
      ) : one && one.type === "image" && largePreview ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPreview(one)}
            aria-label="پیش‌نمایش تصویر"
            className="group relative h-28 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded-xl border-2 border-border/70"
          >
            <CachedImg src={one.url} alt={one.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">{one.name}</p>
            <p className="text-[10px] text-muted-foreground">{bytes(one.size)}</p>
            <p className="text-[10px] text-muted-foreground">{captionHint}</p>
          </div>
          <button type="button" onClick={() => onRemove(0)} aria-label="حذف ضمیمه" className="text-muted-foreground hover:text-destructive">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : one ? (
        <div className="flex items-center gap-2">
          <AttThumb att={one} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">{one.name}</p>
            <p className="text-[10px] text-muted-foreground">{captionHint}</p>
          </div>
          <button type="button" onClick={() => onRemove(0)} aria-label="حذف ضمیمه" className="text-muted-foreground hover:text-destructive">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto">
            {atts.map((att, index) => (
              <div key={`${att.url}-${index}`} className="relative shrink-0">
                {att.type === "image" ? (
                  <button type="button" onClick={() => onPreview(att)} aria-label={att.name} className="block h-16 w-16 overflow-hidden rounded-lg">
                    <CachedImg src={att.url} alt={att.name} className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className="flex h-16 w-28 items-center gap-1 rounded-lg bg-background/70 px-2">
                    <AttThumb att={att} />
                    <span className="min-w-0 truncate text-[10px] font-bold" dir="auto">{att.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={`حذف ${att.name}`}
                  className="absolute -start-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-background text-muted-foreground shadow-soft hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {uploading ? `در حال آپلود… ${fa(Math.round(uploadPct * 100))}٪` : captionHint}
          </p>
        </div>
      )}
    </div>
  );
}

function DownloadAllButton({
  items,
  archiveName,
  mine,
  overlay,
}: {
  items: ChatAttachment[];
  archiveName: string;
  mine: boolean;
  overlay?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-label="دانلود همه"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        void downloadAllAsZip(
          items.map((item) => ({ url: item.url, name: item.name })),
          archiveName,
        )
          .catch((err) => toast.error((err as Error).message || "دانلود ممکن نشد"))
          .finally(() => setBusy(false));
      }}
      className={cn(
        "inline-flex items-center justify-center gap-1 font-bold disabled:opacity-70",
        overlay
          ? "rounded-full bg-black/55 px-2 py-1 text-[10px] text-white backdrop-blur-sm"
          : cn(
              "w-full rounded-xl px-3 py-1.5 text-[11px]",
              mine ? "bg-primary-foreground/15 text-primary-foreground" : "border border-border/50 bg-background/50",
            ),
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      دانلود همه
    </button>
  );
}

function IconSaveButton({ url, name, label }: { url: string; name: string; label: string }) {
  const [pct, setPct] = useState<number | null>(null);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={pct !== null}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pct !== null) return;
        setPct(0);
        void saveRemoteFile(url, name, setPct)
          .catch((err) => toast.error((err as Error).message || "دانلود ممکن نشد"))
          .finally(() => setPct(null));
      }}
      className="grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm disabled:opacity-70"
    >
      {pct !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
    </button>
  );
}

function PhotoSlider({
  photos,
  time,
  edited,
  read,
  pending,
  mine,
  showTime,
  onPreview,
}: {
  photos: ChatAttachment[];
  time: string;
  edited?: boolean;
  read?: boolean;
  pending?: boolean;
  mine: boolean;
  showTime?: boolean;
  onPreview?: (att: ChatAttachment) => void;
}) {
  const [index, setIndex] = useState(0);
  const safe = Math.min(index, Math.max(photos.length - 1, 0));
  const photo = photos[safe];
  if (!photo) return null;
  const step = (dir: number) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i + dir + photos.length) % photos.length);
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onPreview?.(photo)}
        className="block w-full cursor-zoom-in"
        aria-label={`باز کردن ${photo.name}`}
      >
        <CachedImg src={photo.url} alt={photo.name} className="max-h-72 w-full object-cover" />
      </button>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={step(-1)}
            aria-label="عکس قبلی"
            className="absolute start-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={step(1)}
            aria-label="عکس بعدی"
            className="absolute end-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="absolute start-1/2 top-1.5 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
            {fa(safe + 1)} / {fa(photos.length)}
          </span>
        </>
      )}
      <span className="absolute inset-x-1.5 bottom-1.5 flex items-end justify-between gap-1">
        <span className="flex items-center gap-1">
          <IconSaveButton url={photo.url} name={photo.name} label="دانلود این عکس" />
          {photos.length > 1 && <DownloadAllButton items={photos} archiveName="pargar-photos.zip" mine={mine} overlay />}
        </span>
        {showTime && (
          <span className="flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
            <span>{edited ? `ویرایش‌شده · ${clock(time)}` : clock(time)}</span>
            {mine &&
              (pending ? (
                <Clock className="h-3 w-3 animate-spin text-white/80 [animation-duration:1.6s]" />
              ) : (
                <SeenTicks read={read} />
              ))}
          </span>
        )}
      </span>
    </div>
  );
}

function MultiAttach({
  atts,
  mine,
  time,
  edited,
  read,
  pending,
  onPreview,
  inset,
  showTime,
}: {
  atts: ChatAttachment[];
  mine: boolean;
  time: string;
  edited?: boolean;
  read?: boolean;
  pending?: boolean;
  onPreview?: (att: ChatAttachment) => void;
  inset?: boolean;
  showTime?: boolean;
}) {
  const images = atts.filter((a) => a.type === "image");
  const files = atts.filter((a) => a.type === "file");
  const rest = atts.filter((a) => a.type !== "image" && a.type !== "file");
  const photoOnly = images.length > 1 && files.length === 0 && rest.length === 0;
  return (
    <div>
      {images.length > 1 && (
        <div className={cn(inset && "-mx-3.5 -mt-3.5 mb-1.5 overflow-hidden rounded-t-2xl", inset && (mine ? "rounded-l-2xl" : "rounded-r-2xl"))}>
          <PhotoSlider
            photos={images}
            mine={mine}
            time={time}
            edited={edited}
            read={read}
            pending={pending}
            showTime={showTime && photoOnly}
            onPreview={onPreview}
          />
        </div>
      )}
      {images.length === 1 && (
        <div className={cn("relative", inset && "-mx-3.5 -mt-3.5 mb-1.5 overflow-hidden rounded-t-2xl", inset && (mine ? "rounded-l-2xl" : "rounded-r-2xl"))}>
          <button type="button" onClick={() => onPreview?.(images[0])} className="block w-full" aria-label={`باز کردن ${images[0].name}`}>
            <CachedImg src={images[0].url} alt={images[0].name} className="max-h-72 w-full object-cover" />
          </button>
          <span className="absolute bottom-1.5 start-1.5">
            <IconSaveButton url={images[0].url} name={images[0].name} label="دانلود این عکس" />
          </span>
        </div>
      )}
      {(files.length > 0 || rest.length > 0) && (
        <div className={cn("space-y-1.5", !inset && "px-3 py-2", inset && images.length > 0 && "px-0")}>
          {rest.map((att, index) =>
            att.type === "audio" ? (
              <VoicePlayer key={`${att.url}-${index}`} att={att} mine={mine} />
            ) : att.type === "video" ? (
              <ChatVideoPlayer key={`${att.url}-${index}`} att={att} onPreview={() => onPreview?.(att)} />
            ) : (
              <FileSaveButton key={`${att.url}-${index}`} att={att} mine={mine} />
            ),
          )}
          {files.map((att, index) => (
            <FileSaveButton key={`${att.url}-${index}`} att={att} mine={mine} />
          ))}
          {files.length > 1 && <DownloadAllButton items={files} archiveName="pargar-files.zip" mine={mine} />}
        </div>
      )}
      {showTime && !photoOnly && (
        <span className={cn("mt-1 flex items-center gap-1 px-3 text-[10px] leading-none", mine ? "justify-end" : "justify-start")}>
          {edited && <span className={cn("opacity-75", mine ? "text-primary-foreground/70" : "text-muted-foreground/70")}>ویرایش‌شده</span>}
          <span className={cn("opacity-75", mine ? "text-primary-foreground/70" : "text-muted-foreground/70")}>{clock(time)}</span>
          {mine &&
            (pending ? (
              <Clock className="h-3 w-3 animate-spin opacity-70 [animation-duration:1.6s]" />
            ) : (
              <SeenTicks read={read} />
            ))}
        </span>
      )}
    </div>
  );
}

function PreviewSaveButton({ url, name, cache = true }: { url: string; name: string; cache?: boolean }) {
  const [pct, setPct] = useState<number | null>(null);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (pct !== null) return;
        setPct(0);
        void saveRemoteFile(url, name, setPct, { cache })
          .catch((err) => toast.error((err as Error).message || "دانلود ممکن نشد"))
          .finally(() => setPct(null));
      }}
      className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/10 text-white transition-colors hover:bg-white hover:text-black"
      aria-label={pct !== null ? `دانلود ${fa(Math.round(pct * 100))} درصد` : "دانلود"}
      title="دانلود"
    >
      {pct !== null ? (
        <span className="text-[10px] font-black tabular-nums">{fa(Math.round(pct * 100))}</span>
      ) : (
        <Download className="h-4 w-4" />
      )}
      {pct !== null && (
        <span className="absolute inset-x-1 bottom-1 h-0.5 overflow-hidden rounded-full bg-white/30">
          <span className="block h-full bg-white" style={{ width: `${Math.round(pct * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

function MediaOnly({
  att,
  mine,
  time,
  edited,
  read,
  pending,
  onPreview,
}: {
  att: ChatAttachment;
  mine: boolean;
  time: string;
  edited?: boolean;
  read?: boolean;
  pending?: boolean;
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
  const receipt = mine ? (
    pending ? (
      <Clock className="h-3 w-3 animate-spin text-white/80 [animation-duration:1.6s]" />
    ) : (
      <SeenTicks read={read} />
    )
  ) : null;
  const chip = (
    <span className={cn("absolute bottom-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm", corner)}>
      <span>{edited ? `ویرایش‌شده · ${clock(time)}` : clock(time)}</span>
      {receipt}
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
        <CachedImg src={att.url} alt={att.name} className="max-h-72 w-full object-cover" />
        {chip}
      </button>
    );
  }
  if (att.type === "video") {
    return (
      <div className="relative overflow-hidden">
        <ChatVideoPlayer att={att} onPreview={() => onPreview?.(att)} />
        <span className="pointer-events-none absolute end-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
          <span>{edited ? `ویرایش‌شده · ${clock(time)}` : clock(time)}</span>
          {receipt}
        </span>
      </div>
    );
  }
  if (att.type === "audio") {
    return (
      <div className="px-3 py-2">
        <VoicePlayer att={att} mine={mine} />
        <span className={cn("mt-1 flex items-center gap-1 text-[10px] leading-none", mine ? "justify-end" : "justify-start")}>
          {edited && <span className={cn("opacity-75", mine ? "text-primary-foreground/70" : "text-muted-foreground/70")}>ویرایش‌شده</span>}
          <span className={cn("opacity-75", mine ? "text-primary-foreground/70" : "text-muted-foreground/70")}>{clock(time)}</span>
          {mine && (pending ? <Clock className="h-3 w-3 animate-spin opacity-70 [animation-duration:1.6s]" /> : <SeenTicks read={read} />)}
        </span>
      </div>
    );
  }
  return (
    <div className="px-3 py-2">
      <FileSaveButton att={att} mine={mine} />
      <span className={cn("mt-1 flex items-center gap-1 text-[10px] leading-none", mine ? "justify-end" : "justify-start")}>
        <span className={cn("opacity-75", mine ? "text-primary-foreground/70" : "text-muted-foreground/70")}>{clock(time)}</span>
        {mine && (pending ? <Clock className="h-3 w-3 animate-spin opacity-70 [animation-duration:1.6s]" /> : <SeenTicks read={read} />)}
      </span>
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
          <CachedImg src={att.url} alt={att.name} className="max-h-56 w-full object-cover" />
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
        </div>
      </div>
    );
  }
  return <FileSaveButton att={att} mine={mine} className="mb-0.5" />;
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
  const objectKey = mediaObjectKey(att.url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bars] = useState<number[]>(() => voiceBars(objectKey || att.name, 44));
  const [live, setLive] = useState<number[] | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);

  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    a.src = att.url;
    audioRef.current = a;
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onTime = () => setCurrent(a.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
      setLive(null);
      if (activeVoice === a) activeVoice = null;
    };
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.pause();
      a.src = "";
      if (activeVoice === a) activeVoice = null;
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      audioRef.current = null;
      liveRef.current = null;
    };
    // The signed query can refresh without a new recording. Playback stays on this object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectKey]);

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

  const saveVoice = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloading !== null) return;
    setDownloading(0);
    void saveRemoteFile(att.url, att.name || "voice", setDownloading)
      .catch(() => toast.error("دانلود صدا ممکن نشد"))
      .finally(() => setDownloading(null));
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
    if (!a.src) a.src = att.url;
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
          void ctx.resume();
          liveRef.current = { ctx, analyser };
        }
      } catch {
        /* waveform peaks optional */
      }
    }
    void liveRef.current?.ctx.resume();
    void a.play().then(
      () => {
        setPlaying(true);
        if (liveRef.current) startPulse();
      },
      () => {
        setPlaying(false);
        toast.error("پخش صدا ممکن نشد");
      }
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
    <div className="relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-background/50 p-2">
      {downloading !== null && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-primary/15">
          <span className="block h-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(downloading * 100)}%` }} />
        </span>
      )}
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
            {downloading !== null ? `دانلود ${fa(Math.round(downloading * 100))}٪` : fmtDur(dur)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={saveVoice}
        disabled={downloading !== null}
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-70",
          mine ? "text-primary-foreground/80 hover:bg-primary-foreground/15" : "text-muted-foreground hover:bg-background"
        )}
        aria-label="دانلود صدا"
        title="دانلود"
      >
        {downloading !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
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
  const shown = useCachedObjectUrl(src);
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
      src={shown || undefined}
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
    return <CachedImg src={att.url} alt={att.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />;
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

function ChatThreadSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-busy="true" aria-label="در حال بارگذاری پیام‌ها">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
          <Skeleton className={cn("h-14 rounded-2xl", i % 2 ? "w-40" : "w-52")} />
        </div>
      ))}
    </div>
  );
}

function roleLabel(role: string) {
  if (role === "mentor") return "منتور";
  if (role === "admin") return "ادمین";
  return "هنرجو";
}

function presenceLabel(person?: { online?: boolean; lastSeen?: string }) {
  if (!person) return "آفلاین";
  if (person.online) return "آنلاین";
  if (person.lastSeen) return `آخرین بازدید ${formatJalaliStamp(person.lastSeen)}`;
  return "آفلاین";
}

function PresenceLine({ person }: { person?: { online?: boolean; lastSeen?: string } }) {
  const online = !!person?.online;
  return (
    <span className={cn("block h-4 truncate text-[10px] leading-4", online ? "font-bold text-success" : "text-muted-foreground")}>
      {presenceLabel(person)}
    </span>
  );
}

function fa(n: number) {
  return n.toLocaleString("fa-IR");
}

function broadcastAudienceLine(all: boolean, names: string[]): string {
  if (all) return "به همهٔ فعال‌ها می‌رسد";
  if (names.length === 0) return "گیرنده‌ای انتخاب نشده";
  if (names.length === 1) return `به ${names[0]} می‌رسد`;
  if (names.length === 2) return `به ${names[0]} و ${names[1]} می‌رسد`;
  if (names.length === 3) return `به ${names[0]}، ${names[1]} و ${names[2]} می‌رسد`;
  return `به ${fa(names.length)} نفر می‌رسد`;
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
  const atts = messageAttachments(m);
  if (atts.length > 1) {
    if (m.body) return m.body;
    if (atts.every((a) => a.type === "image")) return `${fa(atts.length)} عکس`;
    if (atts.every((a) => a.type === "file")) return `${fa(atts.length)} فایل`;
    return `${fa(atts.length)} پیوست`;
  }
  if (atts[0]) {
    const names: Record<string, string> = { image: "عکس", video: "ویدیو", audio: "پیام صوتی", file: atts[0].name };
    const label = names[atts[0].type] ?? atts[0].name;
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
        <CachedImg
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
  const seen = !!read;
  const label = seen ? "دیده شد" : "ارسال شد";
  return (
    <span
      tabIndex={0}
      className={cn(
        "group/receipt pointer-events-auto inline-flex cursor-default items-center overflow-hidden rounded-full text-[10px] font-extrabold leading-none outline-none transition-all duration-200",
        "hover:gap-0.5 hover:bg-background hover:px-1.5 hover:py-0.5 hover:shadow-sm hover:ring-1",
        "focus-visible:gap-0.5 focus-visible:bg-background focus-visible:px-1.5 focus-visible:py-0.5 focus-visible:shadow-sm focus-visible:ring-1",
        seen
          ? "text-success hover:ring-success/50 focus-visible:ring-success/50"
          : "text-current opacity-80 hover:text-foreground hover:opacity-100 hover:ring-border focus-visible:text-foreground focus-visible:opacity-100 focus-visible:ring-border",
      )}
      aria-label={label}
    >
      {seen ? (
        <CheckCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2.75} />
      ) : (
        <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} />
      )}
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 group-hover/receipt:grid-cols-[1fr] group-focus-visible/receipt:grid-cols-[1fr]">
        <span className="overflow-hidden">
          <span className="whitespace-nowrap ps-0.5">{label}</span>
        </span>
      </span>
    </span>
  );
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
    el.style.height = `${el.scrollHeight}px`;
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
      className="chat-composer my-1 min-h-10 w-full min-w-0 resize-none bg-transparent px-1.5 py-2 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
  const atts = messageAttachments(m);
  if (atts.length > 1) {
    if (atts.every((a) => a.type === "image")) return `📷 ${fa(atts.length)} عکس`;
    if (atts.every((a) => a.type === "file")) return `📄 ${fa(atts.length)} فایل`;
    return `📎 ${fa(atts.length)} پیوست`;
  }
  if (!atts[0]) return "پیام";
  switch (atts[0].type) {
    case "image":
      return "📷 تصویر";
    case "video":
      return "🎬 ویدیو";
    case "audio":
      return "🎙️ پیام صوتی";
    default:
      return `📄 ${atts[0].name}`;
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
  onSave,
  onCopy,
  onPin,
  onEdit,
  editLabel,
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
  onSave?: () => void;
  onCopy: () => void;
  onPin: () => void;
  onEdit?: () => void;
  editLabel?: string;
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
          {onSave && (
            <button
              onClick={onSave}
              aria-label="ذخیره"
              className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <Bookmark className="h-3.5 w-3.5" />
            </button>
          )}
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
        {mine && onEdit && (
          <button
            onClick={onEdit}
            aria-label={editLabel || "ویرایش پیام"}
            title={editLabel || "ویرایش پیام"}
            className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
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