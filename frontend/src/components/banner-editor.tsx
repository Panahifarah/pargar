"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AVATAR_PALETTES } from "@/components/ui/user-avatar";
import { BANNER_FILLS, BANNER_HEIGHT, BANNER_WIDTH, drawBannerFill, type BannerFill } from "@/lib/banner-pattern";
import { toast } from "@/components/providers";
import { cn } from "@/lib/utils";

function FillThumb({
  colors,
  fill,
  seed,
  label,
  active,
  onClick,
}: {
  colors: string[];
  fill: BannerFill;
  seed: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawBannerFill(ctx, canvas.width, canvas.height, colors, fill, seed);
  }, [colors, fill, seed]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-1 text-center transition-colors",
        active ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border hover:bg-muted",
      )}
    >
      <canvas ref={ref} width={240} height={80} className="h-10 w-full rounded-md" />
      <span className={cn("text-[10px] font-bold", active ? "text-primary" : "text-muted-foreground")}>{label}</span>
    </button>
  );
}

function PatternCanvas({
  canvasRef,
  colors,
  seed,
  fill,
  onReady,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  colors: string[];
  seed: string;
  fill: BannerFill;
  onReady: (ready: boolean) => void;
}) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      onReady(false);
      return;
    }
    drawBannerFill(ctx, BANNER_WIDTH, BANNER_HEIGHT, colors, fill, seed);
    onReady(true);
  }, [canvasRef, colors, seed, fill, onReady]);

  return <canvas ref={canvasRef} width={BANNER_WIDTH} height={BANNER_HEIGHT} className="absolute inset-0 h-full w-full" />;
}

function HeaderPreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative aspect-[3/1] w-full overflow-hidden rounded-xl border-2 border-border bg-muted">
      {children}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card via-card/25 to-transparent" />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 aspect-square w-[18%] -translate-x-1/2 translate-y-1/2 rounded-full bg-muted ring-4 ring-card"
      />
    </div>
  );
}

export function BannerEditor({
  open,
  busy,
  onOpenChange,
  onSave,
  onRemove,
}: {
  open: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (blob: Blob) => Promise<void>;
  onRemove?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [fill, setFill] = useState<BannerFill>("gradient");
  const [ready, setReady] = useState(false);

  const palette = AVATAR_PALETTES[paletteIndex] ?? AVATAR_PALETTES[0];

  const save = async () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas || !ready) return;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        toast.error("ساخت تصویر بنر ممکن نشد");
        return;
      }
      await onSave(blob);
    } catch {
      toast.error("ذخیره بنر ممکن نشد");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[min(92dvh,44rem)] w-[calc(100%-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 space-y-1 px-4 pe-12 pt-4 text-start sm:px-6">
          <DialogTitle>ویرایش بنر</DialogTitle>
          <DialogDescription>تصویر عریض پشت نام و آواتار در هدر پروفایل. نسبت حدود ۳ به ۱.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
          <div className="space-y-1.5">
            <HeaderPreview>
              <PatternCanvas
                canvasRef={canvasRef}
                colors={palette.colors}
                seed={palette.label}
                fill={fill}
                onReady={setReady}
              />
            </HeaderPreview>
            <p className="text-[11px] text-muted-foreground">پیش‌نمایش هدر — سایه و جای آواتار فقط برای دیدن نتیجه‌اند و داخل تصویر ذخیره نمی‌شوند.</p>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-bold text-muted-foreground">رنگ‌ها</p>
            <div className="space-y-1">
              {AVATAR_PALETTES.map((p, i) => {
                const active = i === paletteIndex;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPaletteIndex(i)}
                    aria-pressed={active}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 transition-colors",
                      active ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="text-xs font-bold">{p.label}</span>
                    <span className="flex items-center gap-0.5">
                      {p.colors.slice(0, 5).map((c) => (
                        <span
                          key={c}
                          className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                          style={{ background: c }}
                        />
                      ))}
                      {active && <Check className="ms-1 h-3.5 w-3.5 text-primary" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-bold text-muted-foreground">پس‌زمینه</p>
            <div className="grid grid-cols-3 gap-2">
              {BANNER_FILLS.map((item) => (
                <FillThumb
                  key={item.id}
                  colors={palette.colors}
                  fill={item.id}
                  seed={palette.label}
                  label={item.label}
                  active={fill === item.id}
                  onClick={() => setFill(item.id)}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border bg-popover px-4 py-3 sm:flex-row sm:justify-between sm:space-x-0 sm:px-6">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              انصراف
            </Button>
            {onRemove && (
              <Button type="button" variant="outline" onClick={onRemove} disabled={busy}>
                برداشتن بنر
              </Button>
            )}
          </div>
          <Button type="button" onClick={() => void save()} disabled={!ready || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check />}
            {busy ? "در حال ذخیره…" : "ذخیره بنر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
