"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Eye,
  Film,
  Link2,
  Loader2,
  Play,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { http, signedMediaUrl, toUserError } from "@/lib/api";
import { uploadVideo, validateVideoFile } from "@/lib/upload";
import type { Lesson } from "@/lib/types";
import { useConfirm } from "@/components/admin/use-confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/components/providers";
import { Skeleton } from "@/components/ui/skeleton";

type VideoItem = { key: string; size: number; mime?: string; lastModified?: string };

function formatBytes(n: number) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLabel(key: string) {
  const ext = key.toLowerCase().endsWith(".webm") ? "WebM" : "MP4";
  return ext;
}

function VideoThumb({
  videoKey,
  className,
  onOpen,
}: {
  videoKey: string;
  className?: string;
  onOpen?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setUrl(null);
    signedMediaUrl(videoKey)
      .then((u) => {
        if (!cancelled) {
          setUrl(u);
          setState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [videoKey]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted/40",
        className
      )}
      title="پیش‌نمایش"
    >
      {state === "loading" && (
        <span className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </span>
      )}
      {state === "error" && (
        <span className="absolute inset-0 grid place-items-center gap-1 text-muted-foreground">
          <Film className="h-5 w-5" />
          <span className="text-[10px] font-bold">پیش‌نمایش نیست</span>
        </span>
      )}
      {url && state === "ready" && (
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          onError={() => setState("error")}
        />
      )}
      <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/35">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-background/90 text-foreground opacity-80 shadow-sm group-hover:opacity-100">
          <Play className="h-4 w-4 fill-current" />
        </span>
      </span>
    </button>
  );
}

function VideoPreviewDialog({
  videoKey,
  onClose,
}: {
  videoKey: string | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoKey) return;
    let cancelled = false;
    setUrl(null);
    setError(null);
    signedMediaUrl(videoKey)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setError(toUserError(e, "پیش‌نمایش ویدیو ممکن نشد"));
      });
    return () => {
      cancelled = true;
    };
  }, [videoKey]);

  return (
    <Dialog open={!!videoKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-start">
          <DialogTitle className="text-base font-black">پیش‌نمایش ویدیو</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs" dir="ltr">
            {videoKey}
          </DialogDescription>
        </DialogHeader>
        <div className="bg-black px-0 py-0">
          {error && (
            <div className="flex items-center gap-2 px-6 py-10 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {!error && !url && (
            <div className="grid h-56 place-items-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {url && (
            <video src={url} controls playsInline className="max-h-[70vh] w-full bg-black" autoPlay />
          )}
        </div>
        <DialogFooter className="border-t border-border px-6 py-3 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            بستن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VideosPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [q, setQ] = useState("");
  const [attachKey, setAttachKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["admin", "videos"],
    queryFn: () => http.get<{ videos: VideoItem[] }>("/api/admin/videos"),
    retry: 1,
  });
  const videos = data?.videos ?? [];

  const {
    data: lessonsData,
    isError: lessonsError,
    error: lessonsErr,
    refetch: refetchLessons,
  } = useQuery({
    queryKey: ["admin", "lessons"],
    queryFn: () => http.get<{ lessons: Lesson[] }>("/api/admin/lessons"),
    retry: 1,
  });
  const lessons = lessonsData?.lessons ?? [];

  const usedByKey = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const l of lessons) {
      if (!l.videoKey) continue;
      const arr = map.get(l.videoKey) ?? [];
      arr.push(l);
      map.set(l.videoKey, arr);
    }
    return map;
  }, [lessons]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return videos;
    return videos.filter((v) => v.key.toLowerCase().includes(term));
  }, [videos, q]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    const invalid = validateVideoFile(file);
    if (invalid) {
      toast.error(invalid);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    void upload(file);
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadVideo(0, file);
      await qc.invalidateQueries({ queryKey: ["admin", "videos"] });
      toast.success(file.name.toLowerCase().endsWith(".webm") ? "WebM آپلود شد" : "MP4 آپلود شد");
      setAttachKey(res.key);
    } catch (e) {
      toast.error(toUserError(e, "آپلود ویدیو ممکن نشد"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const del = async (key: string) => {
    if (!(await confirm("حذف ویدیو", `فایل «${key}» از کتابخانه حذف شود؟`))) return;
    try {
      await http.del(`/api/admin/videos?key=${encodeURIComponent(key)}`);
      await qc.invalidateQueries({ queryKey: ["admin", "videos"] });
      toast.success("از کتابخانه حذف شد");
    } catch (e) {
      toast.error(toUserError(e, "حذف ویدیو ممکن نشد"));
    }
  };

  return (
    <>
      {dialog}
      <div className="space-y-4">
        <Card className="border border-dashed border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col items-stretch gap-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="min-w-0 text-center sm:text-right">
              <p className="text-lg font-black">آپلود ویدیو</p>
              <p className="mt-1 text-sm text-muted-foreground">
                فقط <span className="font-bold text-foreground">MP4</span> (پیشنهادی) یا{" "}
                <span className="font-bold text-foreground">WebM</span> · حداکثر ۲۰۰ مگابایت
              </p>
              <p className="mt-1 text-xs text-muted-foreground">بعد از آپلود، درس مقصد را انتخاب کنید.</p>
            </div>
            <div className="flex shrink-0 justify-center">
              <input
                ref={fileRef}
                type="file"
                accept=".mp4,.webm,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => pick(e.target.files?.[0])}
              />
              <Button
                size="lg"
                className="min-w-40 gap-2"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "در حال آپلود…" : "انتخاب MP4 / WebM"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {(isError || lessonsError) && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 font-bold text-destructive">
              {toUserError(isError ? error : lessonsErr, "بارگذاری کتابخانه ممکن نشد")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void refetch();
                void refetchLessons();
              }}
            >
              تلاش دوباره
            </Button>
          </div>
        )}

        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                کتابخانه ویدیو
                {isFetching && !isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {videos.length} فایل · روی تصویر بزنید تا پخش شود
              </p>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جستجوی نام فایل…"
                className="h-10 ps-9"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="grid gap-3 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-52 rounded-2xl" />
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((v) => {
                const used = usedByKey.get(v.key) ?? [];
                return (
                  <div
                    key={v.key}
                    className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3"
                  >
                    <VideoThumb videoKey={v.key} onOpen={() => setPreviewKey(v.key)} />
                    <div className="min-w-0 px-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {formatLabel(v.key)}
                        </Badge>
                        {v.key === "sample.mp4" && (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                            پیش‌فرض پلیر
                          </Badge>
                        )}
                        <p className="truncate text-sm font-extrabold" title={v.key} dir="ltr">
                          {v.key}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(v.size)}</p>
                      {v.key === "sample.mp4" && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          اگر درسی ویدیو نداشته باشد، این فایل به‌صورت خودکار در پلیر پخش می‌شود.
                        </p>
                      )}
                      {used.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {used.map((l) => (
                            <Badge key={l.id} variant="secondary" className="text-[10px]">
                              L{l.id} · {l.title}
                            </Badge>
                          ))}
                        </div>
                      ) : v.key !== "sample.mp4" ? (
                        <p className="mt-2 text-[11px] font-bold text-warning">به هیچ درسی وصل نیست</p>
                      ) : null}
                    </div>
                    <div className="flex gap-2 px-1 pb-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => setPreviewKey(v.key)}
                      >
                        <Eye className="h-3.5 w-3.5" /> پخش
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5"
                        onClick={() => setAttachKey(v.key)}
                        disabled={lessons.length === 0}
                      >
                        <Link2 className="h-3.5 w-3.5" /> وصل به درس
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => void del(v.key)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {filtered.length === 0 && !isLoading && !isError && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {q ? "نتیجه‌ای نیست" : "هنوز ویدیویی آپلود نشده — یک MP4 انتخاب کنید"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <AttachVideoDialog
        videoKey={attachKey}
        lessons={lessons}
        onClose={() => setAttachKey(null)}
        onDone={() => {
          setAttachKey(null);
          void qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
        }}
      />
      <VideoPreviewDialog videoKey={previewKey} onClose={() => setPreviewKey(null)} />
    </>
  );
}

function AttachVideoDialog({
  videoKey,
  lessons,
  onClose,
  onDone,
}: {
  videoKey: string | null;
  lessons: Lesson[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(null);
  }, [videoKey]);

  const attach = async () => {
    if (!videoKey || selected == null) return;
    const lesson = lessons.find((l) => l.id === selected);
    if (!lesson) {
      toast.error("درس انتخاب‌شده پیدا نشد.");
      return;
    }
    setBusy(true);
    try {
      await http.put(`/api/admin/lessons/${lesson.id}`, { ...lesson, videoKey });
      toast.success(`ویدیو به «${lesson.title}» وصل شد`);
      onDone();
    } catch (e) {
      toast.error(toUserError(e, "اتصال ویدیو به درس ممکن نشد"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!videoKey}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-start">
          <DialogTitle>وصل کردن ویدیو به درس</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs" dir="ltr">
            {videoKey}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-y-auto px-4 py-3">
          {lessons.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              هنوز درسی نیست — اول از تب دروس یک درس بسازید.
            </p>
          )}
          {lessons
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((l) => {
              const active = selected === l.id;
              const already = l.videoKey === videoKey;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelected(l.id)}
                  className={cn(
                    "grid w-full grid-cols-[2rem_minmax(0,1fr)_1rem] items-center gap-3 rounded-xl border px-3 py-3 text-right transition-colors",
                    active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  )}
                >
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-muted text-xs font-black">
                    L{l.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold">{l.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {already ? "همین ویدیو وصل است" : l.videoKey ? `فعلی: ${l.videoKey}` : "بدون ویدیو"}
                    </span>
                  </span>
                  {active ? <Check className="h-4 w-4 text-primary" /> : <span />}
                </button>
              );
            })}
        </div>
        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button variant="outline" className="h-10" onClick={onClose} disabled={busy}>
            انصراف
          </Button>
          <Button className="h-10 min-w-24" disabled={selected == null || busy} onClick={() => void attach()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "وصل کن"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Compact picker for LessonDialog — browse library instead of typing the key. */
export function VideoKeyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "videos"],
    queryFn: () => http.get<{ videos: VideoItem[] }>("/api/admin/videos"),
    enabled: open,
    retry: 1,
  });
  const videos = data?.videos ?? [];
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return videos;
    return videos.filter((v) => v.key.toLowerCase().includes(term));
  }, [videos, q]);

  return (
    <div className="space-y-2">
      <Label>ویدیو درس</Label>
      <div className="flex gap-2">
        <div
          className={cn(
            "flex min-h-11 flex-1 items-center gap-2 rounded-xl border px-3",
            value ? "border-success/40 bg-success/5" : "border-dashed border-border"
          )}
        >
          <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate text-sm font-bold", !value && "text-muted-foreground")} dir="ltr">
            {value || "ویدیویی انتخاب نشده"}
          </span>
          {value && (
            <button
              type="button"
              className="ms-auto shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onChange("")}
              aria-label="پاک کردن ویدیو"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0 gap-1.5" onClick={() => setOpen(true)}>
          <Search className="h-4 w-4" /> انتخاب
        </Button>
      </div>
      {value && (
        <button
          type="button"
          onClick={() => setPreviewKey(value)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
        >
          <Eye className="h-3.5 w-3.5" /> پیش‌نمایش ویدیو انتخاب‌شده
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-start">
            <DialogTitle>انتخاب از کتابخانه</DialogTitle>
            <DialogDescription>فقط MP4 و WebMهای آپلودشده</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو…" className="h-10 ps-9" />
            </div>
            {isError && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{toUserError(error)}</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => void refetch()}>
                  دوباره
                </Button>
              </div>
            )}
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {isLoading && <Skeleton className="h-24 rounded-xl" />}
              {filtered.map((v) => {
                const active = v.key === value;
                return (
                  <div
                    key={v.key}
                    className={cn(
                      "grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-2",
                      active ? "border-primary bg-primary/10" : "border-border"
                    )}
                  >
                    <VideoThumb
                      videoKey={v.key}
                      className="rounded-lg"
                      onOpen={() => setPreviewKey(v.key)}
                    />
                    <button
                      type="button"
                      className="min-w-0 text-right"
                      onClick={() => {
                        onChange(v.key);
                        setOpen(false);
                      }}
                    >
                      <span className="block truncate text-sm font-extrabold" dir="ltr">
                        {v.key}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatLabel(v.key)} · {formatBytes(v.size)}
                      </span>
                    </button>
                    {active ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => {
                          onChange(v.key);
                          setOpen(false);
                        }}
                      >
                        انتخاب
                      </Button>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && !isLoading && !isError && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  ویدیویی نیست — اول از تب ویدیوها یک MP4 آپلود کنید
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <VideoPreviewDialog videoKey={previewKey} onClose={() => setPreviewKey(null)} />
    </div>
  );
}
