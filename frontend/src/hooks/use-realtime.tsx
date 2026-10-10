"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-store";
import { getWsUrl } from "@/lib/api";
import { toast } from "@/components/providers";

interface WSPayload {
  type?: string;
  item?: {
    type?: string;
    title?: string;
    body?: string;
    category?: string;
    route?: string;
  };
  from?: number;
  [key: string]: unknown;
}

/** Connects to the realtime gateway, toasts live notifications and bumps unread counts. */
export function useRealtimeGateway() {
  const accessToken = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const client = useQueryClient();
  const router = useRouter();
  const lastEvent = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        // Prefer subprotocol when we have an in-memory access token; otherwise rely on httpOnly cookie.
        ws = accessToken
          ? new WebSocket(getWsUrl(), ["bearer", accessToken])
          : new WebSocket(getWsUrl());
      } catch {
        return;
      }
      ws.onopen = () => {
        retry = 0;
      };
      ws.onmessage = (ev) => {
        try {
          const p: WSPayload = JSON.parse(ev.data);
          if (p.type === "notification" && p.item) {
            const n = p.item;
            const stamp = Date.now();
            const dedupeKey = `${n.type}:${n.title}:${n.body}`;
            if (stamp - (lastEvent.current[dedupeKey] ?? 0) < 2000) return;
            lastEvent.current[dedupeKey] = stamp;

            const title = n.title?.trim() || "اعلان";
            const body = n.body?.trim();
            toast.custom(
              (id) => (
                <button
                  type="button"
                  dir="rtl"
                  onClick={() => {
                    toast.dismiss(id);
                    if (n.route) router.push(n.route);
                  }}
                  className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-primary/40 bg-gradient-to-br from-primary/25 via-primary/12 to-accent/20 px-3 py-2.5 text-start shadow-[0_16px_40px_-16px_color-mix(in_srgb,var(--color-primary)_75%,transparent)] backdrop-blur-md"
                >
                  <span dir="auto" className="block truncate text-sm font-semibold text-foreground [unicode-bidi:plaintext]">
                    {title}
                  </span>
                  {body ? (
                    <span dir="auto" className="mt-0.5 block line-clamp-2 text-xs text-foreground/75 [unicode-bidi:plaintext]">
                      {body}
                    </span>
                  ) : null}
                </button>
              ),
              { duration: 5000 },
            );
            client.invalidateQueries({ queryKey: ["notifications"] });
            client.invalidateQueries({ queryKey: ["me"] });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retry += 1;
        const t = Math.min(1000 * 2 ** retry, 15000);
        setTimeout(connect, t);
      };
    };

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [accessToken, user, client, router]);

  return null;
}
