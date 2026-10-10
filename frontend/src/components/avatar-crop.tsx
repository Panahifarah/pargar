"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Scan, X, ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const OUTPUT_SIZE = 512;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function AvatarCropDialog({
  file,
  busy,
  error,
  onCancel,
  onInvalid,
  onCrop,
}: {
  file: File | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onInvalid?: () => void;
  onCrop: (blob: Blob) => Promise<void> | void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<{ el: HTMLImageElement; w: number; h: number } | null>(null);
  const [C, setC] = useState(280);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [localError, setLocalError] = useState<string | null>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const onInvalidRef = useRef(onInvalid);
  onInvalidRef.current = onInvalid;
  const fittedFor = useRef<HTMLImageElement | null>(null);
  const fittedSize = useRef(0);

  useEffect(() => {
    if (!file) {
      setImg(null);
      return;
    }
    let cancel = false;
    setLocalError(null);
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      if (cancel) return;
      setImg({ el, w: el.naturalWidth, h: el.naturalHeight });
    };
    el.onerror = () => {
      if (cancel) return;
      setImg(null);
      onInvalidRef.current?.();
    };
    el.src = url;
    return () => {
      cancel = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!img) return;
    let ro: ResizeObserver | null = null;
    let frame = 0;
    let tries = 0;
    const fit = () => {
      const box = boxRef.current;
      if (!box) {
        if (tries++ < 40) frame = requestAnimationFrame(fit);
        return;
      }
      if (!ro) {
        ro = new ResizeObserver(fit);
        ro.observe(box);
      }
      const size = Math.round(Math.min(box.clientWidth, 320));
      if (size < 8) return;
      setC(size);
      if (fittedFor.current === img.el && Math.abs(fittedSize.current - size) < 2) return;
      fittedFor.current = img.el;
      fittedSize.current = size;
      const min = size / Math.min(img.w, img.h);
      setScale(min);
      setPan({ x: (size - img.w * min) / 2, y: (size - img.h * min) / 2 });
    };
    fit();
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [img]);

  const minScale = img ? C / Math.min(img.w, img.h) : 1;
  const maxScale = minScale * 6;

  const clampPan = (x: number, y: number, s: number) => ({
    x: clamp(x, C - (img?.w ?? C) * s, 0),
    y: clamp(y, C - (img?.h ?? C) * s, 0),
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.sx;
    const dy = e.clientY - drag.current.sy;
    setPan(clampPan(drag.current.px + dx, drag.current.py + dy, scale));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const zoom = (s: number) => {
    const next = clamp(s, minScale, maxScale);
    const cx = C / 2;
    const cy = C / 2;
    const imgX = (cx - pan.x) / scale;
    const imgY = (cy - pan.y) / scale;
    setPan(clampPan(cx - imgX * next, cy - imgY * next, next));
    setScale(next);
  };

  const setZoomIn = () => {
    if (!img) return;
    const ms = C / Math.min(img.w, img.h);
    setScale(ms);
    setPan({ x: (C - img.w * ms) / 2, y: (C - img.h * ms) / 2 });
  };

  const confirm = async () => {
    if (!img || !(scale > 0) || C < 8) return;
    const cropSize = C / scale;
    let cx = -pan.x / scale;
    let cy = -pan.y / scale;
    if (!(cropSize > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
    cx = clamp(cx, 0, Math.max(0, img.w - cropSize));
    cy = clamp(cy, 0, Math.max(0, img.h - cropSize));

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.el, cx, cy, cropSize, cropSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) {
      setLocalError("ساخت تصویر آواتار ممکن نشد");
      return;
    }
    await onCrop(blob);
  };

  const zoomPct = maxScale > 0 ? Math.round((scale / maxScale) * 100) : 17;

  return (
    <Dialog open={!!file && !!img} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>تنظیم عکس آواتار</DialogTitle>
        </DialogHeader>

        <div className="relative mx-auto aspect-square w-full max-w-[280px]" ref={boxRef}>
          {img ? (
            <>
              <div
                className="absolute inset-0 touch-none select-none overflow-hidden rounded-full ring-2 ring-border"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ cursor: "move" }}
              >
                <img
                  src={img.el.src}
                  alt="پیش‌نمایش آواتار"
                  draggable={false}
                  className="pointer-events-none select-none"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    transform: `translate(${pan.x}px, ${pan.y}px)`,
                    width: img.w * scale,
                    height: img.h * scale,
                    maxWidth: "none",
                    maxHeight: "none",
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{
                    background: "rgba(0,0,0,0.45)",
                    WebkitMaskImage: "radial-gradient(circle at center, transparent 49.2%, black 50%)",
                    maskImage: "radial-gradient(circle at center, transparent 49.2%, black 50%)",
                  }}
                />
              </div>
              <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary/70 ring-offset-2 ring-offset-background" />
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="range"
            min={17}
            max={100}
            value={zoomPct}
            onChange={(e) => zoom((Number(e.target.value) / 100) * maxScale)}
            aria-label="بزرگ‌نمایی"
            className="w-full accent-primary"
          />
        </div>

        {(error || localError) && <p className="text-[11px] font-bold text-destructive">{error || localError}</p>}

        <DialogFooter className="sm:space-x-0 sm:space-x-reverse sm:justify-between">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            <X /> انصراف
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={setZoomIn} disabled={busy} title="تنظیم خودکار">
              <Scan /> برازش
            </Button>
            <Button onClick={confirm} disabled={busy || !img || !(scale > 0) || C < 8}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check />}
              {busy ? "در حال آپلود…" : "تأیید و ذخیره"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}