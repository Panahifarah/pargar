"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Renders a small markdown subset. Raw HTML is escaped by React text nodes. */
export function SafeMarkdown({
  text,
  className,
  lines,
}: {
  text: string;
  className?: string;
  /** When set, only the first block is shown, clamped to this many lines. */
  lines?: 2 | 3;
}) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const shown = lines ? blocks.slice(0, 1) : blocks;
  return (
    <div className={className}>
      {shown.map((block, i) => (
        <p
          key={i}
          dir="auto"
          className={cn(
            "break-words [unicode-bidi:plaintext]",
            lines === 2 && "line-clamp-2",
            lines === 3 && "line-clamp-3",
            !lines && "whitespace-pre-wrap",
          )}
        >
          {inline(block)}
        </p>
      ))}
    </div>
  );
}

function inline(src: string): ReactNode[] {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    if (m[1] && m[2]) {
      nodes.push(
        <a key={k++} href={m[2]} target="_blank" rel="noreferrer" className="underline">
          {m[1]}
        </a>,
      );
    } else if (m[3]) {
      nodes.push(<strong key={k++}>{m[3]}</strong>);
    } else if (m[4]) {
      nodes.push(
        <code key={k++} className="rounded bg-muted px-1">
          {m[4]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}
