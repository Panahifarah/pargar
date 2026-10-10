/** Wide profile-header artwork. Palettes come from the avatar studio; these fills stretch them across a 3:1 banner. */

export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 400;

export type BannerFill = "gradient" | "stripes" | "dots" | "diamonds" | "pixel" | "waves";

export const BANNER_FILLS: { id: BannerFill; label: string }[] = [
  { id: "gradient", label: "گرادیان" },
  { id: "stripes", label: "راه‌راه" },
  { id: "dots", label: "نقطه‌ای" },
  { id: "diamonds", label: "لوزی" },
  { id: "pixel", label: "پیکسلی" },
  { id: "waves", label: "موج" },
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function palette(colors: string[]): string[] {
  return colors.length >= 2 ? colors : ["#7d6df2", "#0f9b8e"];
}

export function drawBannerFill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: string[],
  fill: BannerFill,
  seedKey: string,
) {
  const c = palette(colors);
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  if (fill === "gradient") {
    const g = ctx.createLinearGradient(0, h, w, 0);
    c.forEach((color, i) => g.addColorStop(i / (c.length - 1), color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.04, w * 0.5, h * 0.42, w * 0.46);
    glow.addColorStop(0, "rgba(255,255,255,0.22)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  ctx.fillStyle = c[0];
  ctx.fillRect(0, 0, w, h);

  if (fill === "stripes") {
    const stripe = Math.max(14, w / 26);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 7);
    const span = w + h;
    let i = 0;
    for (let x = -span; x < span; x += stripe) {
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = c[i % c.length];
      ctx.fillRect(x, -span, stripe * 0.58, span * 2);
      i++;
    }
    ctx.restore();
    return;
  }

  if (fill === "dots") {
    const gap = Math.max(22, w / 28);
    const radius = gap * 0.22;
    let row = 0;
    for (let y = gap * 0.55; y < h + gap; y += gap * 0.86) {
      const offset = row % 2 ? gap / 2 : 0;
      let col = 0;
      for (let x = offset; x < w + gap; x += gap) {
        ctx.beginPath();
        ctx.fillStyle = c[(row + col) % c.length];
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        col++;
      }
      row++;
    }
    return;
  }

  if (fill === "diamonds") {
    const gap = Math.max(28, w / 18);
    const s = gap * 0.42;
    let row = 0;
    for (let y = gap * 0.2; y < h + gap; y += gap * 0.72) {
      const offset = row % 2 ? gap / 2 : 0;
      let col = 0;
      for (let x = offset; x < w + gap; x += gap) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = c[(row + col) % c.length];
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
        col++;
      }
      row++;
    }
    return;
  }

  if (fill === "pixel") {
    const cols = 18;
    const rows = 6;
    const cw = w / cols;
    const ch = h / rows;
    const rand = mulberry32(hash(`${seedKey}:pixel`));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = c[Math.floor(rand() * c.length)];
        ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
      }
    }
    return;
  }

  const bands = c.length;
  for (let b = 0; b < bands; b++) {
    const amp = h * (0.055 + (b % 3) * 0.012);
    const freq = 1.15 + (b % 4) * 0.35;
    const base = h * (0.16 + (b / bands) * 0.72);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, base);
    for (let x = 0; x <= w; x += 8) {
      const y = base + Math.sin((x / w) * Math.PI * 2 * freq + b * 0.85) * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.globalAlpha = b === 0 ? 0.45 : 0.94;
    ctx.fillStyle = c[b];
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
