"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { http, toUserError } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  validateEmail,
  validateName,
  validatePassword,
  clampPhoneInput,
  normalizePhone,
  PHONE_INPUT_MAX_LEN,
  validatePhone,
  validateSecurityQA,
  validateUsername,
} from "@/lib/validation";

const STEPS = [
  { id: 1, title: "هویت", hint: "نام، شناسه و تلفن" },
  { id: 2, title: "امنیت", hint: "ایمیل و سوال امنیتی" },
  { id: 3, title: "گذرواژه", hint: "رمز و کد امنیتی" },
] as const;

type CaptchaChallenge = {
  challengeId: string;
  imageBase64: string;
};

type RegisterFormProps = {
  endpoint: string;
  submitLabel: string;
  description?: string;
};

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function RegisterForm({ endpoint, submitLabel, description }: RegisterFormProps) {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (step === 3) {
      void loadCaptcha();
    }
  }, [step, loadCaptcha]);

  const goNext = () => {
    setError(null);
    if (step === 1) {
      const nErr = validateName(name);
      if (nErr) {
        setError(nErr);
        return;
      }
      const uErr = validateUsername(username);
      if (uErr) {
        setError(uErr);
        return;
      }
      const pErr = validatePhone(phone);
      if (pErr) {
        setError(pErr);
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      const eErr = validateEmail(email);
      if (eErr) {
        setError(eErr);
        return;
      }
      const sErr = validateSecurityQA(securityQuestion, securityAnswer);
      if (sErr) {
        setError(sErr);
        return;
      }
      setStep(3);
    }
  };

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      goNext();
      return;
    }
    setError(null);
    const pwErr = validatePassword(password, passwordConfirm);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    if (!challenge) {
      setError("ابتدا کد امنیتی را بارگذاری کنید");
      void loadCaptcha();
      return;
    }
    setLoading(true);
    try {
      const data = await http.post<{ accessToken: string; refreshToken: string; user: User }>(
        endpoint,
        {
          name: name.trim(),
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          password,
          passwordConfirm,
          phone: normalizePhone(phone),
          securityQuestion: securityQuestion.trim(),
          securityAnswer: securityAnswer.trim(),
          challengeId: challenge.challengeId,
          captchaAnswer,
        },
      );
      setSession(data.accessToken, data.refreshToken, data.user);
      router.push("/cap");
    } catch (err) {
      setError(toUserError(err, "ثبت‌نام ناموفق بود"));
      void loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const currentStep = STEPS[step - 1];
  const progressPct = (step / STEPS.length) * 100;

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      {description && (
        <p className="text-center text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-bold text-foreground">
            گام {step} از {STEPS.length}
          </span>
          <span className="text-muted-foreground">{currentStep?.hint}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <ol className="grid grid-cols-3 gap-2" aria-label="مراحل ثبت‌نام">
          {STEPS.map((s) => {
            const active = step === s.id;
            const done = step > s.id;
            return (
              <li
                key={s.id}
                className={cn(
                  "rounded-lg px-2 py-2 text-center text-xs font-medium transition-colors",
                  active && "bg-primary/10 text-primary",
                  done && "text-primary",
                  !active && !done && "text-muted-foreground",
                )}
                aria-current={active ? "step" : undefined}
              >
                {s.title}
              </li>
            );
          })}
        </ol>
      </div>

      <form onSubmit={(ev) => void submit(ev)} className="space-y-4">
        {step === 1 && (
          <>
            <Field id="reg-name" label="نام و نام خانوادگی">
              <Input
                id="reg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                autoFocus
              />
            </Field>
            <Field id="reg-username" label="شناسه کاربری">
              <Input
                id="reg-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                dir="ltr"
                className="text-left"
                autoComplete="username"
              />
            </Field>
            <Field id="reg-phone" label="شماره تلفن">
              <Input
                id="reg-phone"
                value={phone}
                onChange={(e) => setPhone(clampPhoneInput(e.target.value))}
                dir="ltr"
                className="text-left"
                placeholder="0912…"
                autoComplete="tel"
                inputMode="tel"
                maxLength={PHONE_INPUT_MAX_LEN}
              />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <Field id="reg-email" label="ایمیل">
              <Input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                className="text-left"
                autoComplete="email"
                autoFocus
              />
            </Field>
            <Field id="reg-secQ" label="سوال امنیتی">
              <Input
                id="reg-secQ"
                value={securityQuestion}
                onChange={(e) => setSecurityQuestion(e.target.value)}
                placeholder="مثلاً نام مدرسهٔ اول؟"
              />
            </Field>
            <Field id="reg-secA" label="جواب امنیتی">
              <PasswordInput
                id="reg-secA"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
                autoComplete="off"
                dir="rtl"
                placeholder="جواب سوال امنیتی"
              />
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <Field id="reg-password" label="رمز عبور">
              <PasswordInput
                id="reg-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                autoFocus
                placeholder="حداقل ۸ نویسه"
              />
            </Field>
            <Field id="reg-password-confirm" label="تکرار رمز عبور">
              <PasswordInput
                id="reg-password-confirm"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                placeholder="همان رمز را دوباره وارد کنید"
              />
            </Field>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="reg-captcha">کد امنیتی</Label>
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
                  id="reg-captcha"
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
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-stretch gap-2.5 pt-1">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 shrink-0 px-4"
              onClick={goBack}
              disabled={loading}
            >
              <ArrowRight className="h-4 w-4" />
              قبلی
            </Button>
          )}
          {step < 3 ? (
            <Button type="submit" variant="gradient" className="h-12 min-w-0 flex-1" size="lg">
              بعدی
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="gradient"
              className="h-12 min-w-0 flex-1"
              size="lg"
              disabled={loading || captchaLoading || !challenge}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {submitLabel}
            </Button>
          )}
        </div>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        حساب دارید؟{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          ورود
        </Link>
      </p>
    </div>
  );
}
