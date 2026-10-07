"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Lock,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion } from "framer-motion";
import { api, http, toUserError } from "@/lib/api";
import type { Lesson, LessonProgress } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/providers";

const INTERVAL_MS = 10_000;
const SEEK_FORWARD_SLACK = 0.35;
const CONTINUOUS_PLAY_MAX_DT = 3;

export function VideoPlayer({
  lessonId,
  videoUrl,
  duration,
  completionThresholdPct,
  initialProgress,
}: {
  lessonId: number;
  videoUrl: string;
  duration: number;
  completionThresholdPct: number;
  initialProgress?: LessonProgress | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Lock first signed URL for this mount so React Query refetch cannot reset src.
  const lockedSrcRef = useRef(videoUrl);
  const resumeAppliedRef = useRef(false);
  const accRef = useRef(0);
  const lastTimeRef = useRef(0);
  /** Furthest continuous playback position — forward seeks snap back to this. */
  const maxTrustedPosRef = useRef(0);
  const seekToastAtRef = useRef(0);
  const seqRef = useRef(0);
  const programmaticSeekRef = useRef(false);
  const refreshingSrcRef = useRef(false);
  const sendHeartbeatRef = useRef<(pos: number, delta: number) => Promise<void>>(async () => undefined);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [watchedPct, setWatchedPct] = useState(initialProgress?.watchedPct ?? 0);
  const [quizUnlocked, setQuizUnlocked] = useState(!!initialProgress?.quizUnlocked);
  const [quizUnlockedNow, setQuizUnlockedNow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uiIdle, setUiIdle] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(duration);
  const hideTimer = useRef<number | null>(null);

  const warnSeekBlocked = useCallback(() => {
    const now = Date.now();
    if (now - seekToastAtRef.current < 2500) return;
    seekToastAtRef.current = now;
    toast.error("پرش سریع و نمایش شناور مجاز نیست");
  }, []);

  const flushAcc = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const delta = accRef.current;
    accRef.current = 0;
    if (delta < 0.05) return;
    void sendHeartbeatRef.current(v.currentTime, delta);
  }, []);

  const seekProgrammatic = useCallback((to: number) => {
    const v = videoRef.current;
    if (!v) return;
    programmaticSeekRef.current = true;
    v.currentTime = Math.max(0, to);
    lastTimeRef.current = v.currentTime;
    setPosition(v.currentTime);
    window.setTimeout(() => {
      programmaticSeekRef.current = false;
    }, 120);
  }, []);

  // resume once, only if still near the start (don't yank mid-play)
  useEffect(() => {
    let cancelled = false;
    resumeAppliedRef.current = false;
    (async () => {
      try {
        const { position: p, lastSeq } = await api<{ position: number; lastSeq?: number }>(
          `/api/lessons/${lessonId}/resume`
        );
        if (typeof lastSeq === "number" && lastSeq > seqRef.current) {
          seqRef.current = lastSeq;
        }
        if (cancelled || resumeAppliedRef.current || !(p > 1)) return;
        const apply = () => {
          const v = videoRef.current;
          if (!v || resumeAppliedRef.current) return;
          if (v.currentTime >= 1) {
            resumeAppliedRef.current = true;
            return;
          }
          const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration;
          if (p < dur - 2) {
            programmaticSeekRef.current = true;
            v.currentTime = p;
            setPosition(p);
            lastTimeRef.current = p;
            maxTrustedPosRef.current = Math.max(maxTrustedPosRef.current, p);
            window.setTimeout(() => {
              programmaticSeekRef.current = false;
            }, 120);
          }
          resumeAppliedRef.current = true;
        };
        if (videoRef.current) {
          if (videoRef.current.readyState >= 1) apply();
          else videoRef.current.addEventListener("loadedmetadata", apply, { once: true });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId, duration]);

  // Seed trusted position from known server progress so resume + scrub-back stay consistent.
  useEffect(() => {
    if (initialProgress?.lastPosition && initialProgress.lastPosition > 0) {
      maxTrustedPosRef.current = Math.max(maxTrustedPosRef.current, initialProgress.lastPosition);
    }
  }, [initialProgress?.lastPosition]);

  const sendHeartbeat = useCallback(
    async (pos: number, delta: number) => {
      seqRef.current += 1;
      try {
        const res = await api<{ watchedPct: number; quizUnlocked: boolean; quizUnlockedNow: boolean }>(
          `/api/lessons/${lessonId}/heartbeat`,
          { method: "POST", body: { position: pos, delta, seq: seqRef.current } }
        );
        setWatchedPct(res.watchedPct);
        if (res.quizUnlocked) {
          setQuizUnlocked(true);
        }
        if (res.quizUnlockedNow) {
          setQuizUnlockedNow(true);
          toast.success("آزمون باز شد! می‌توانید آموخته‌هایتان را محک بزنید.");
        }
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        if (msg.includes("locked") || msg.includes("قفل")) {
          toast.error(msg);
          return;
        }
        toast.error(toUserError(e, "همگام‌سازی تماشا قطع شد — اتصال را بررسی کنید"));
      }
    },
    [lessonId]
  );

  useEffect(() => {
    sendHeartbeatRef.current = sendHeartbeat;
  }, [sendHeartbeat]);

  // anti-cheat: real playback only, lock rate/PiP, snap forward seeks
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    v.disablePictureInPicture = true;
    v.disableRemotePlayback = true;
    v.playbackRate = 1;
    v.defaultPlaybackRate = 1;

    const lockRate = () => {
      if (v.playbackRate !== 1) {
        v.playbackRate = 1;
        warnSeekBlocked();
      }
      if (v.defaultPlaybackRate !== 1) {
        v.defaultPlaybackRate = 1;
      }
    };

    const snapForwardSeek = () => {
      if (programmaticSeekRef.current) return false;
      const max = maxTrustedPosRef.current;
      if (v.currentTime > max + SEEK_FORWARD_SLACK) {
        programmaticSeekRef.current = true;
        v.currentTime = max;
        lastTimeRef.current = max;
        setPosition(max);
        window.setTimeout(() => {
          programmaticSeekRef.current = false;
        }, 120);
        warnSeekBlocked();
        return true;
      }
      return false;
    };

    const onTimeUpdate = () => {
      lockRate();
      if (snapForwardSeek()) return;
      const dt = v.currentTime - lastTimeRef.current;
      if (dt > 0 && dt < CONTINUOUS_PLAY_MAX_DT) {
        accRef.current += dt;
        if (v.currentTime > maxTrustedPosRef.current) {
          maxTrustedPosRef.current = v.currentTime;
        }
      }
      lastTimeRef.current = v.currentTime;
      setPosition(v.currentTime);
    };

    const onEnded = () => {
      setPlaying(false);
      const delta = accRef.current;
      accRef.current = 0;
      void sendHeartbeatRef.current(v.currentTime, delta);
    };

    const blockPiP = () => {
      void (async () => {
        try {
          if (document.pictureInPictureElement === v) {
            await document.exitPictureInPicture();
          }
        } catch {
          /* ignore */
        }
        v.pause();
        warnSeekBlocked();
      })();
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded);
    v.addEventListener("seeking", snapForwardSeek);
    v.addEventListener("seeked", snapForwardSeek);
    v.addEventListener("ratechange", lockRate);
    v.addEventListener("enterpictureinpicture", blockPiP);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("seeking", snapForwardSeek);
      v.removeEventListener("seeked", snapForwardSeek);
      v.removeEventListener("ratechange", lockRate);
      v.removeEventListener("enterpictureinpicture", blockPiP);
    };
  }, [lessonId, warnSeekBlocked]);

  // periodic verified heartbeats + visibility flush
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const sendPending = (opts?: { evenIfPaused?: boolean }) => {
      const delta = accRef.current;
      if (delta < 0.05) return;
      if (!opts?.evenIfPaused && (v.paused || v.ended)) return;
      accRef.current = 0;
      void sendHeartbeatRef.current(v.currentTime, delta);
    };

    const iv = window.setInterval(() => sendPending(), INTERVAL_MS);
    const flush = () => sendPending({ evenIfPaused: true });
    const onPause = () => sendPending({ evenIfPaused: true });
    const vis = () => {
      if (document.hidden) {
        sendPending({ evenIfPaused: true });
        if (!v.paused) v.pause();
      }
      if (document.pictureInPictureElement === v) {
        void document.exitPictureInPicture().catch(() => undefined);
        v.pause();
      }
    };
    v.addEventListener("pause", onPause);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearInterval(iv);
      v.removeEventListener("pause", onPause);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [lessonId]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted]);

  const refreshSignedUrl = useCallback(async () => {
    if (refreshingSrcRef.current) return;
    refreshingSrcRef.current = true;
    try {
      const data = await http.get<{ lesson: Lesson; videoUrl: string; progress: LessonProgress | null }>(
        `/api/lessons/${lessonId}`
      );
      if (!data.videoUrl) {
        setLoadError("ویدیوی این درس در دسترس نیست.");
        return;
      }
      lockedSrcRef.current = data.videoUrl;
      const v = videoRef.current;
      if (v) {
        const keep = v.currentTime;
        const wasPlaying = !v.paused;
        v.src = data.videoUrl;
        v.load();
        const restore = () => {
          if (keep > 0) {
            programmaticSeekRef.current = true;
            v.currentTime = keep;
            lastTimeRef.current = keep;
            window.setTimeout(() => {
              programmaticSeekRef.current = false;
            }, 120);
          }
          if (wasPlaying) void v.play().catch(() => undefined);
        };
        v.addEventListener("loadedmetadata", restore, { once: true });
      }
      if (data.progress) {
        setWatchedPct(data.progress.watchedPct);
        if (data.progress.quizUnlocked) setQuizUnlocked(true);
      }
      setLoadError(null);
      setLoading(true);
    } catch {
      setLoadError("بارگذاری مجدد ویدیو ممکن نشد. دوباره تلاش کنید.");
    } finally {
      refreshingSrcRef.current = false;
    }
  }, [lessonId]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => toast.error("پخش ویدیو ممکن نشد"));
    else v.pause();
  };

  const onPlayChange = useCallback(() => {
    const v = videoRef.current;
    setPlaying(!!v && !v.paused);
  }, []);

  const poke = useCallback(() => {
    setUiIdle(false);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    const v = videoRef.current;
    if (v && !v.paused && !v.ended) {
      hideTimer.current = window.setTimeout(() => setUiIdle(true), 2600);
    }
  }, []);

  const skipBack = () => {
    const v = videoRef.current;
    if (!v) return;
    flushAcc();
    seekProgrammatic(Math.max(0, v.currentTime - 10));
    poke();
  };

  const restartFromStart = () => {
    const v = videoRef.current;
    if (!v) return;
    flushAcc();
    seekProgrammatic(0);
    void v.play().catch(() => undefined);
    poke();
  };

  useEffect(() => {
    if (playing) poke();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [playing, poke]);

  const pct = mediaDuration > 0 ? Math.min(100, (position / mediaDuration) * 100) : 0;
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      <div
        className="group relative overflow-hidden rounded-xl border border-border bg-black shadow-soft"
        onMouseMove={poke}
        onPointerDown={poke}
      >
        <video
          ref={videoRef}
          src={lockedSrcRef.current}
          className="aspect-video w-full"
          controls={false}
          controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
          disablePictureInPicture
          playsInline
          preload="metadata"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          onPlay={() => {
            const el = videoRef.current;
            if (el) {
              el.playbackRate = 1;
              el.defaultPlaybackRate = 1;
            }
            setLoadError(null);
            onPlayChange();
            poke();
          }}
          onPause={() => {
            onPlayChange();
            poke();
          }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => {
            setLoading(false);
            setBuffering(false);
          }}
          onCanPlay={() => {
            setLoading(false);
            setBuffering(false);
          }}
          onLoadedMetadata={() => {
            const el = videoRef.current;
            if (el && Number.isFinite(el.duration) && el.duration > 0) {
              setMediaDuration(el.duration);
            }
          }}
          onError={() => {
            setLoading(false);
            setBuffering(false);
            setLoadError("پخش ویدیو قطع شد. در حال تلاش برای اتصال مجدد…");
            void refreshSignedUrl();
          }}
          muted={muted}
        />
        {(loading || buffering) && !loadError && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="h-24 w-24 rounded-full" />
              <Skeleton className="h-3 w-24 rounded-full" />
            </div>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
            <p className="text-sm font-bold text-white">{loadError}</p>
            <Button type="button" variant="secondary" onClick={() => void refreshSignedUrl()}>
              تلاش دوباره
            </Button>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center" onClick={poke}>
          {!playing && !buffering && !loading && !loadError && (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.05 }}
              onClick={toggle}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
              aria-label="پخش"
            >
              <Play className="ms-1 h-8 w-8 fill-white" />
            </motion.button>
          )}
        </div>

        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 transition-opacity duration-300 ${
            uiIdle ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="mb-2 flex items-center gap-1 text-[11px] font-medium text-white/90">
            <span className="rounded bg-white/10 px-2 py-0.5">تماشای تاییدشده</span>
            <Lock className="h-3 w-3 opacity-60" />
            <span className="opacity-80">پرش سریع غیرفعال است</span>
            <span className="ms-auto tabular-nums">
              {fmt(position)} / {fmt(mediaDuration)}
            </span>
          </div>
          <div className="relative">
            <Progress value={pct} className="h-2 bg-white/15" gradient />
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-[inset-inline-start] duration-300 ease-out"
              style={{ insetInlineStart: `calc(${pct}% - 8px)` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
              aria-label="پخش / توقف"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={skipBack}
              className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
              aria-label="بازگشت ۱۰ ثانیه"
              title="۱۰ ثانیه عقب"
            >
              <SkipBack className="h-5 w-5 scale-x-[-1]" />
            </button>
            <button
              type="button"
              onClick={restartFromStart}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20"
              aria-label="شروع از اول"
              title="شروع از اول"
            >
              <RotateCcw className="h-4 w-4" />
              شروع از اول
            </button>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
              aria-label="قطع صدا"
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <span className="ms-auto text-xs text-white/70">
              {Math.round(watchedPct)}٪ تماشای تاییدشده
            </span>
          </div>
        </div>

        {quizUnlockedNow && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute end-4 top-4 z-30"
          >
            <Button asChild variant="gradient" size="lg">
              <Link href={`/quiz/${lessonId}`}>شروع آزمون</Link>
            </Button>
          </motion.div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">پیشرفت تماشای تاییدشده</p>
          <p className="text-xs text-muted-foreground">
            ضربان‌های ارسالی هر {INTERVAL_MS / 1000} ثانیه، زمان واقعی تماشا را تایید می‌کنند. رسیدن به آستانه{" "}
            {completionThresholdPct}٪ آزمون را باز می‌کند.
          </p>
        </div>
        <div className="w-40 shrink-0">
          <Progress value={watchedPct} gradient smooth />
          <p className="mt-1 text-end text-xs text-muted-foreground">{Math.round(watchedPct)}٪</p>
        </div>
        {quizUnlocked ? (
          <Button asChild variant="gradient">
            <Link href={`/quiz/${lessonId}`}>شروع آزمون</Link>
          </Button>
        ) : (
          <Button disabled variant="outline">
            <Lock className="h-4 w-4" /> آزمون قفل است
          </Button>
        )}
      </div>
    </div>
  );
}
