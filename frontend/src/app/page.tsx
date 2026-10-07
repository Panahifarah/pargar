"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpenCheck,
  Clock3,
  Flag,
  PlayCircle,
  Sparkles,
  Timer,
  UnlockKeyhole,
  Users2,
  Zap,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { Reveal } from "@/components/reveal";
import Link from "next/link";
import { http } from "@/lib/api";

const stats = [
  { value: "۱۲", label: "هفته مسیر", tile: "bg-primary text-primary-foreground" },
  { value: "۶", label: "درس ویدیویی", tile: "bg-accent text-accent-foreground" },
  { value: "۳", label: "فصل مهارتی", tile: "bg-gold text-gold-foreground" },
  { value: "۱۸", label: "سوال آزمون", tile: "bg-success text-success-foreground" },
];

const steps = [
  {
    icon: PlayCircle,
    step: "۰۱",
    title: "تماشای کامل",
    desc: "ویدیو را همان‌طور واقعی تماشا کنید؛ زمان، به‌راستی تأیید می‌شود.",
    tile: "bg-primary text-primary-foreground",
  },
  {
    icon: BookOpenCheck,
    step: "۰۲",
    title: "قبولی در آزمون",
    desc: "آزمون همان درس را باز می‌کند؛ هر اشتباه یک قلب هزینه دارد.",
    tile: "bg-accent text-accent-foreground",
  },
  {
    icon: UnlockKeyhole,
    step: "۰۳",
    title: "باز شدن شاخه‌ها",
    desc: "با هر قبولی، شاخه‌های بعدی درخت مهارت آزاد می‌شوند.",
    tile: "bg-gold text-gold-foreground",
  },
];

const features = [
  {
    icon: Timer,
    title: "تماشای تاییدشده",
    desc: "زمان تماشا با ضربان‌های دوره‌ای راستی‌آزمایی می‌شود؛ میان‌بر و پرش سریع جواب نمی‌دهد.",
    tile: "bg-primary/10 text-primary",
  },
  {
    icon: Users2,
    title: "آزمون با قلب‌ها",
    desc: "هر پاسخ اشتباه یک قلب کم می‌کند. با سه اشتباه، حساب قفل می‌شود — مجبورید واقعاً یاد بگیرید.",
    tile: "bg-accent/10 text-accent",
  },
  {
    icon: Sparkles,
    title: "جامعه و منتور",
    desc: "رویدادهای زنده، لیگ هفتگی و گفتگوی یک‌به‌یک با منتور برای وقتی که به مانع می‌خورید.",
    tile: "bg-gold/10 text-gold",
  },
];

const principles = [
  "پیش‌نیازهای واقعی — هر شاخه فقط بعد از قبولی در والدش باز می‌شود",
  "بدون میان‌بر — پرش سریع و چندبرابری، غیرفعال است",
  "قفل پس از سه اشتباه؛ رفع قفل فقط با بررسی مدیریت",
  "لیگ هفتگی که هر دوشنبه از نو آغاز می‌شود",
];

export default function Home() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const { data: sponsorsData } = useQuery({
    queryKey: ["sponsors"],
    queryFn: () => http.get<{ sponsors: { name: string; url?: string; blurb?: string }[] }>("/api/sponsors"),
    staleTime: 60_000,
  });
  const sponsors = sponsorsData?.sponsors ?? [];

  const goCap = () => router.push("/cap");
  const goLogin = () => router.push("/login");

  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center">
      {/* hero */}
      <section className="relative w-full overflow-hidden rounded-2xl border-2 border-border bg-card px-6 py-16 text-center shadow-offset sm:px-12 sm:py-24">
        <div className="dot-grid dot-grid-primary pointer-events-none absolute -end-16 -top-16 h-72 w-72 opacity-70" aria-hidden />
        <span className="pointer-events-none absolute end-8 top-8 hidden h-8 w-8 rotate-12 rounded-lg bg-accent sm:block" aria-hidden />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="reveal reveal-1">
            <BrandMark size="lg" />
          </div>
          <div className="reveal reveal-2 mt-6 flex flex-wrap items-center justify-center gap-2">
            {["بدون میان‌بر", "۱۲ هفته", "منتور ۱:۱"].map((c) => (
              <span key={c} className="chip-outline border-primary text-primary bg-primary/5">
                {c}
              </span>
            ))}
          </div>
          <p className="section-kicker reveal reveal-3 mt-6 justify-center">بوت‌کمپ ۱۲ هفته‌ای دگرگونی</p>
          <h1 className="reveal reveal-4 mt-4 text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            با انضباط،{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span className="text-primary">متحول</span>
              <span className="absolute inset-x-0 -bottom-1 h-4 rounded-sm bg-accent/20" aria-hidden />
            </span>{" "}
            شو
          </h1>
          <p className="reveal reveal-5 mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
            پلتفرمی که خودش حرف نمی‌زند — زمان تماشا، آزمون‌ها و قفل‌شدن را جدا از قضاوت خودتان کنترل
            می‌کند تا یادگیری واقعاً رخ بدهد.
          </p>
          <div className="reveal reveal-5 mt-9 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Button size="lg" onClick={goCap} className="gap-2 px-8">
                <Zap className="h-5 w-5" /> ادامه مسیر
              </Button>
            ) : (
              <>
                <Button size="lg" onClick={goLogin} className="gap-2 px-8">
                  ورود
                </Button>
                <Button size="lg" variant="outline" onClick={goLogin} className="gap-2 px-8">
                  <Zap className="h-5 w-5" /> شروع مسیر
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* stats strip — solid color blocks */}
      <section className="mt-8 w-full">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal
              key={s.label}
              delay={i * 0.07}
              className={`${s.tile} flex flex-col items-center justify-center rounded-2xl px-6 py-8 text-center shadow-offset-sm hover-lift`}
            >
              <p className="text-4xl font-black tabular-nums">{s.value}</p>
              <p className="mt-1.5 text-xs font-bold opacity-90">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mt-20 w-full">
        <div className="mx-auto max-w-md space-y-3 text-center">
          <p className="section-kicker justify-center">چگونه کار می‌کند</p>
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">مسیری که گریز ندارد</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            بقای شما در بوت‌کمپ صفر و یک است؛ سیستم نمی‌پذیرد که فقط «خوب دیدن کردم» بگویید.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.step} delay={i * 0.1} className="group relative flex flex-col rounded-2xl border-2 border-border bg-card p-6 shadow-offset-sm hover-lift">
              <div className="flex items-center justify-between">
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${s.tile} shadow-offset-sm`}>
                  <s.icon className="h-6 w-6" />
                </span>
                <span className="text-3xl font-black tabular-nums text-muted-foreground/30">{s.step}</span>
              </div>
              <h3 className="mt-5 text-lg font-extrabold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* features */}
      <section className="mt-20 w-full">
        <h2 className="text-center text-3xl font-black tracking-tight sm:text-4xl">
          چرا منحصربه‌فرد <span className="text-accent">است</span>
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.1} className="card-hover rounded-2xl border-2 border-border bg-card p-6">
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${f.tile}`}>
                <f.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-lg font-extrabold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* principles — inverted editorial band */}
      <section className="band-invert mt-20 w-full rounded-2xl p-8 sm:p-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="lg:sticky lg:top-24 lg:max-w-xs">
            <p className="section-kicker text-accent">
              <span className="text-accent">اصول غیرقابل مذاکره</span>
            </p>
            <h2 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">
              مهم نیست قول
              <br />
              بدهید؛ سیستم
              <br />
              <span className="text-accent">ثبت می‌کند.</span>
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:flex-1">
            {principles.map((p, i) => (
              <Reveal key={p} delay={i * 0.08} className="flex items-start gap-3 rounded-2xl border-2 border-border/60 p-5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-success/20">
                  <Flag className="h-4 w-4 text-success" />
                </span>
                <p className="text-sm font-medium leading-relaxed opacity-90">{p}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {sponsors.length > 0 && (
        <section className="mt-20 w-full">
          <div className="mx-auto max-w-md space-y-3 text-center">
            <p className="section-kicker justify-center">حامیان</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">اسپانسرهای پرگار</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              سازمان‌ها و افرادی که مسیر یادگیری را ممکن می‌کنند.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sponsors.map((sp, i) => {
              const inner = (
                <Reveal
                  delay={i * 0.08}
                  className="flex h-full flex-col rounded-2xl border-2 border-border bg-card p-6 shadow-offset-sm transition hover-lift"
                >
                  <p className="text-lg font-extrabold">{sp.name}</p>
                  {sp.blurb && (
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{sp.blurb}</p>
                  )}
                  {sp.url && (
                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-primary">
                      مشاهده <ExternalLink className="h-3.5 w-3.5" />
                    </span>
                  )}
                </Reveal>
              );
              return sp.url ? (
                <a key={`${sp.name}-${i}`} href={sp.url} target="_blank" rel="noopener noreferrer" className="block">
                  {inner}
                </a>
              ) : (
                <div key={`${sp.name}-${i}`}>{inner}</div>
              );
            })}
          </div>
        </section>
      )}

      {/* final CTA */}
      <section className="mt-20 w-full pb-4 text-center">
        <Reveal>
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 shadow-offset-sm float-slow">
            <Clock3 className="h-7 w-7 text-accent" />
          </span>
          <h2 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">آماده آغازید؟</h2>
          <p className="mt-3 text-base text-muted-foreground">۱۲ هفته اثر — و سیستم کنترل را خودش بر عهده می‌گیرد.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Button size="lg" onClick={goCap} className="gap-2 px-8">
                <PlayCircle className="h-5 w-5" /> ادامه مسیر
              </Button>
            ) : (
              <>
                <Button size="lg" asChild className="gap-2 px-8">
                  <Link href="/login">ورود</Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="gap-2 px-8">
                  <Link href="/login">
                    <PlayCircle className="h-5 w-5" /> شروع مسیر
                  </Link>
                </Button>
              </>
            )}
          </div>
          <p className="mt-10 text-xs text-muted-foreground">
            <BrandMark locale="fa" size="sm" className="align-middle" /> — نسخهٔ نمایشی · توسعه‌یافته توسط امیرحسین پناهی‌فر
          </p>
        </Reveal>
      </section>
    </div>
  );
}