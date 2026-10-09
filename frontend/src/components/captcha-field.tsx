"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CaptchaChallenge = {
  challengeId: string;
  imageBase64: string;
  expiresIn?: number;
};

const FALLBACK_SECONDS = 120;

export function CaptchaField({
  id,
  value,
  onChange,
  onChallenge,
  onError,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onChallenge: (challenge: CaptchaChallenge | null) => void;
  onError?: (message: string | null) => void;
}) {
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [left, setLeft] = useState(FALLBACK_SECONDS);
  const gen = useRef(0);
  const rotating = useRef(false);
  const onChallengeRef = useRef(onChallenge);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  onChallengeRef.current = onChallenge;
  onChangeRef.current = onChange;
  onErrorRef.current = onError;

  const load = useCallback(async (silent: boolean) => {
    if (silent && rotating.current) return;
    if (silent) rotating.current = true;
    const ticket = ++gen.current;
    if (!silent) setLoading(true);
    try {
      const data = await http.get<CaptchaChallenge>("/api/auth/captcha");
      if (ticket !== gen.current) return;
      setChallenge(data);
      onChallengeRef.current(data);
      setLeft(Math.max(15, Math.round(data.expiresIn || FALLBACK_SECONDS)));
      onChangeRef.current("");
      onErrorRef.current?.(null);
    } catch (err) {
      if (ticket !== gen.current) return;
      if (!silent) {
        setChallenge(null);
        onChallengeRef.current(null);
      }
      onErrorRef.current?.(toUserError(err, "بارگذاری کد امنیتی ممکن نشد"));
    } finally {
      rotating.current = false;
      if (ticket === gen.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          void load(true);
          return n;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [challenge, load]);

  const minutes = String(Math.floor(left / 60)).padStart(1, "0");
  const seconds = String(left % 60).padStart(2, "0");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>کد امنیتی</Label>
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          تازه‌سازی
          {challenge && (
            <span className="tabular-nums text-muted-foreground" dir="ltr">
              {minutes}:{seconds}
            </span>
          )}
        </button>
      </div>
      <div className="flex items-stretch gap-3">
        <div
          className="relative flex h-14 min-w-[9.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/60 shadow-inner"
          aria-live="polite"
        >
          {challenge?.imageBase64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/png;base64,${challenge.imageBase64}`}
              alt="کد امنیتی"
              width={160}
              height={52}
              className="h-full w-full object-contain select-none"
              draggable={false}
            />
          ) : (
            <span className="text-sm text-muted-foreground">{loading ? "…" : "—"}</span>
          )}
          {challenge && (
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/15"
            >
              <span
                className="block h-full bg-primary transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.min(100, (left / Math.max(challenge.expiresIn || FALLBACK_SECONDS, 1)) * 100)}%` }}
              />
            </span>
          )}
        </div>
        <Input
          id={id}
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          required
          dir="ltr"
          className="h-14 text-center font-mono tracking-widest uppercase placeholder:text-center"
          placeholder="کد تصویر"
          maxLength={6}
        />
      </div>
    </div>
  );
}
