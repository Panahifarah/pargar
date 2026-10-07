"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Timer, Zap } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { useAuth } from "@/lib/auth-store";
import { http, toUserError } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const perks = [
  { icon: Timer, text: "زمان تماشای راستی‌آزمایی‌شده — بدون میان‌بر" },
  { icon: ShieldCheck, text: "قفل‌شدن پس از سه اشتباه، تا وقتی واقعاً یاد بگیرید" },
  { icon: CheckCircle2, text: "لیگ هفتگی، رویداد زنده و منتور یک‌به‌یک" },
];

type CaptchaChallenge = {
  challengeId: string;
  imageBase64: string;
};

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(true);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: registerStatus } = useQuery({
    queryKey: ["auth", "register-status"],
    queryFn: () => http.get<{ enabled: boolean }>("/api/auth/register-status"),
  });

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaAnswer("");
    try {
      const data = await http.get<CaptchaChallenge>("/api/auth/captcha");
      setChallenge(data);
    } catch (err) {
      setChallenge(null);
      setError(toUserError(err, "بارگذاری کد امنیتی ممکن نشد"));
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) {
      setError("ابتدا کد امنیتی را بارگذاری کنید");
      void loadCaptcha();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await http.post<{ accessToken: string; refreshToken: string; user: User }>("/api/auth/login", {
        username: email,
        password,
        challengeId: challenge.challengeId,
        captchaAnswer,
        rememberMe,
      });
      setSession(data.accessToken, data.refreshToken, data.user);
      router.push("/cap");
    } catch (err) {
      setError(toUserError(err, "ورود ناموفق بود"));
      void loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-4xl flex-col justify-center px-4 py-8">
      <div className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-soft md:grid-cols-2">
        {/* brand panel */}
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-7 text-primary-foreground md:flex">
          <div className="dot-grid pointer-events-none absolute -end-20 -top-20 h-72 w-72 rotate-12 text-primary-foreground opacity-50" aria-hidden />
          <span className="pointer-events-none absolute end-8 top-8 h-6 w-6 rotate-12 rounded-md bg-accent" aria-hidden />
          <div className="relative">
            <BrandMark locale="fa" size="lg" className="text-primary-foreground [&_span]:text-accent" />
            <p className="section-kicker on-primary mt-5">بوت‌کمپ دگرگونی</p>
            <h2 className="mt-3 text-2xl font-bold leading-snug">
              سیستم، میان‌بر ندارد.
              <br />
              شما هم ندارید.
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-primary-foreground/80">
              یادگیری را قابل کنترل و قابل اثبات می‌کند — برای خودتان هم که شده.
            </p>
          </div>
          <ul className="relative mt-6 space-y-2.5">
            {perks.map((p) => (
              <li key={p.text} className="flex items-start gap-2.5 text-sm">
                <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-foreground/90" />
                <span className="leading-relaxed text-primary-foreground/90">{p.text}</span>
              </li>
            ))}
          </ul>
        </aside>

        {/* form panel */}
        <div className="flex flex-col justify-center bg-card p-6 sm:p-8">
          <CardHeader className="items-center space-y-1.5 px-0 pb-5 pt-0 text-center">
            <div className="mb-1 flex justify-center md:hidden">
              <BrandMark locale="fa" size="lg" logoOnly />
            </div>
            <CardTitle className="text-2xl">خوش برگشتید</CardTitle>
            <CardDescription>برای ادامه مسیر خود وارد شوید.</CardDescription>
          </CardHeader>
          <CardContent className="mx-auto w-full max-w-md px-0 pt-0">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">شناسه کاربری</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">رمز عبور</Label>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="رمز عبور"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="captcha">کد امنیتی</Label>
                  <button
                    type="button"
                    onClick={() => void loadCaptcha()}
                    disabled={captchaLoading}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${captchaLoading ? "animate-spin" : ""}`} />
                    تازه‌سازی
                  </button>
                </div>
                <div className="flex items-stretch gap-3">
                  <div
                    className="relative flex h-14 min-w-[9.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/60 shadow-inner"
                    aria-live="polite"
                  >
                    {captchaLoading || !challenge?.imageBase64 ? (
                      <span className="text-sm text-muted-foreground">…</span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:image/png;base64,${challenge.imageBase64}`}
                        alt="کد امنیتی"
                        width={160}
                        height={52}
                        className="h-full w-full object-contain select-none"
                        draggable={false}
                      />
                    )}
                  </div>
                  <Input
                    id="captcha"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value.toUpperCase())}
                    required
                    dir="ltr"
                    className="h-14 text-center font-mono tracking-widest uppercase placeholder:text-center"
                    placeholder="کد تصویر"
                    maxLength={6}
                  />
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>مرا به یاد داشته باش</span>
                <Switch
                  checked={rememberMe}
                  onCheckedChange={setRememberMe}
                  aria-label="مرا به یاد داشته باش"
                />
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                variant="gradient"
                className="h-12 w-full"
                size="lg"
                disabled={loading || captchaLoading || !challenge}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} ورود
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {registerStatus?.enabled ? (
                <>
                  حساب ندارید؟{" "}
                  <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
                    ثبت‌نام
                  </Link>
                </>
              ) : (
                "حساب شما توسط متصدی بوت‌کمپ ساخته و اعلام می‌شود."
              )}
            </p>
          </CardContent>
        </div>
      </div>
    </div>
  );
}
