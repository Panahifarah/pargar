"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  CalendarPlus,
  Eraser,
  Pencil,
  Trophy,
  Users,
} from "lucide-react";
import { http } from "@/lib/api";
import type { AdminStats } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SKETCH_KEY = "pargar.admin.statsSketch";
const NOTES_KEY = "pargar.admin.statsNotes";

/** Ink is always stored black; CSS invert makes it white in dark mode. */
const SKETCH_INK = "#000000";

export function StatsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => http.get<{ stats: AdminStats }>("/api/admin/stats"),
  });
  const [notes, setNotes] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState(true);

  useEffect(() => {
    setNotes(localStorage.getItem(NOTES_KEY) ?? "");
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = 220;
    if (w <= 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = SKETCH_INK;
    const saved = localStorage.getItem(SKETCH_KEY);
    if (saved) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, h);
      img.src = saved;
    }
  }, [isLoading]);

  const persistCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      localStorage.setItem(SKETCH_KEY, canvas.toDataURL("image/png"));
    } catch {
      /* ignore quota */
    }
  };

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawing.current = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (ink) {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = SKETCH_INK;
      ctx.lineWidth = 2.5;
    } else {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = 16;
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    persistCanvas();
  };

  const clearSketch = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    localStorage.removeItem(SKETCH_KEY);
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-border/70 bg-card p-5">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <Skeleton className="mt-3 h-6 w-12" />
            <Skeleton className="mt-1 h-3 w-20" />
          </div>
        ))}
      </div>
    );
  }

  const s = data?.stats;
  const cards = [
    { label: "هنرجویان", value: s?.users ?? 0, icon: Users, klass: "text-primary bg-primary/10", hint: "هنرجویان با حساب فعال" },
    { label: "درس‌ها", value: s?.lessons ?? 0, icon: BookOpen, klass: "text-secondary bg-secondary/10", hint: "درس‌های ثبت‌شده در درخت" },
    { label: "سوالات", value: s?.questions ?? 0, icon: Activity, klass: "text-accent bg-accent/10", hint: "بانک سوالات آزمون" },
    { label: "رویدادها", value: s?.events ?? 0, icon: CalendarPlus, klass: "text-gold bg-gold/10", hint: "جلسات و کارگاه‌ها" },
    { label: "تکمیل‌ها", value: s?.completions ?? 0, icon: Trophy, klass: "text-success bg-success/10", hint: "قبولی آزمون درس‌ها" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="overflow-hidden border">
            <CardContent className="pt-5">
              <div className={cn("mb-3 flex h-11 w-11 items-center justify-center rounded-2xl", c.klass)}>
                <c.icon className="h-5 w-5" />
              </div>
              <p className="text-3xl font-black tabular-nums">{c.value}</p>
              <p className="text-sm font-bold">{c.label}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">بوم یادداشت دستی</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">اسکچ و ایده‌های جلسه را اینجا بکشید؛ روی همین مرورگر ذخیره می‌شود.</p>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={ink ? "default" : "outline"}
                className="h-8 gap-1"
                onClick={() => setInk(true)}
              >
                <Pencil className="h-3.5 w-3.5" /> قلم
              </Button>
              <Button
                size="sm"
                variant={!ink ? "default" : "outline"}
                className="h-8 gap-1"
                onClick={() => setInk(false)}
              >
                <Eraser className="h-3.5 w-3.5" /> پاک‌کن
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={clearSketch}>
                پاک کردن
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border border-dashed border-border bg-muted/20">
              <canvas
                ref={canvasRef}
                className="h-[220px] w-full touch-none dark:invert"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">یادداشت متنی</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">چک‌لیست یا نکات عملیاتی برای تیم منتور.</p>
          </CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                localStorage.setItem(NOTES_KEY, e.target.value);
              }}
              rows={9}
              placeholder="مثلاً: این هفته ویدیوی فصل ۲ را آپلود کنیم…"
              className="min-h-[200px] resize-y"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
