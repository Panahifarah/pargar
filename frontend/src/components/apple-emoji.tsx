"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Apple Color Emoji PNGs served from /emoji/apple/64 (vendored from
 * emoji-datasource-apple). External CDNs are blocked in many networks.
 */
const APPLE_BASE = "/emoji/apple/64";

/** Convert an emoji grapheme to Apple datasource filename stem (e.g. ❤️ → 2764-fe0f). */
export function emojiToAppleCode(emoji: string): string | null {
  const cps: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    // Text-presentation selector only — keep FE0F (required for ❤️ etc.)
    if (cp === 0xfe0e) continue;
    cps.push(cp.toString(16));
  }
  if (cps.length === 0) return null;
  return cps.join("-");
}

/** Candidate filenames: with FE0F as typed, then without FE0F segments. */
export function appleEmojiCandidates(emoji: string): string[] {
  const primary = emojiToAppleCode(emoji);
  if (!primary) return [];
  const out = [`${APPLE_BASE}/${primary}.png`];
  if (primary.includes("fe0f")) {
    const stripped = primary
      .split("-")
      .filter((p) => p !== "fe0f")
      .join("-");
    if (stripped && stripped !== primary) {
      out.push(`${APPLE_BASE}/${stripped}.png`);
    }
  } else {
    // Some keycaps / symbols are stored with -fe0f even when the string lacks it
    out.push(`${APPLE_BASE}/${primary}-fe0f.png`);
  }
  return out;
}

export function appleEmojiSrc(emoji: string): string | null {
  return appleEmojiCandidates(emoji)[0] ?? null;
}

export function AppleEmoji({
  emoji,
  size = 20,
  className,
  title,
}: {
  emoji: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const candidates = useMemo(() => appleEmojiCandidates(emoji), [emoji]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = candidates[idx];

  if (!src || failed) {
    return (
      <span
        className={cn("inline-block leading-none", className)}
        style={{ fontSize: size, fontFamily: "'Apple Color Emoji', 'Segoe UI Emoji', sans-serif" }}
        title={title}
        role="img"
        aria-label={emoji}
      >
        {emoji}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={emoji}
      title={title ?? emoji}
      width={size}
      height={size}
      draggable={false}
      className={cn("inline-block align-[-0.15em] object-contain", className)}
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => {
        if (idx + 1 < candidates.length) {
          setIdx((i) => i + 1);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

const EMOJI_RE =
  /(?:\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*)|\p{Regional_Indicator}{2}/gu;

/** Render plain text with Apple emoji images inline. */
export function AppleEmojiText({
  text,
  size = 18,
  className,
}: {
  text: string;
  size?: number;
  className?: string;
}) {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(EMOJI_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      parts.push(<span key={`t${i++}`}>{text.slice(last, idx)}</span>);
    }
    parts.push(<AppleEmoji key={`e${i++}`} emoji={match[0]} size={size} />);
    last = idx + match[0].length;
  }
  if (last < text.length) {
    parts.push(<span key={`t${i++}`}>{text.slice(last)}</span>);
  }
  return <span className={className}>{parts}</span>;
}
