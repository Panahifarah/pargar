"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-store";

export default function BotDocsPage() {
  const user = useAuth((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/admin");
    }
  }, [user, router]);

  if (!user || user.role !== "admin") {
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground">
          <Link href="/admin?tab=bots" className="underline-offset-4 hover:underline">
            ربات
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight">راهنمای ربات</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          با یک کلید API می‌توانید از بیرون پرگار به هنرجو پیام بفرستید و جواب‌های او را بخوانید.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-base font-black">ساخت کلید</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          در مدیریت، بخش ربات، یک نام بگذارید و «ساخت ربات» را بزنید. پاسخ ساخت شامل فیلد <Code>token</Code> است.
          توکن فقط یک بار نشان داده می‌شود. بعد از بستن یا بارگذاری دوبارهٔ صفحه دیگر برنمی‌گردد؛ سرور فقط هش آن را نگه می‌دارد.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          هر ردیف نام، زمان ساخت، وضعیت و تعداد درخواست‌های تأییدشده را نشان می‌دهد. با «توقف» کلید متوقف می‌شود و با «فعال‌کردن» دوباره کار می‌کند.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-base font-black">احراز هویت</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          هر دو مسیر زیر هدر <Code>X-Bot-Token</Code> می‌خواهند. توکن خالی، ناشناس یا متوقف با وضعیت ۴۰۱ و پیام «توکن ربات نامعتبر است» رد می‌شود.
          درخواست ناموفق در شمارنده حساب نمی‌شود. هر فراخوانی که توکن فعالش پذیرفته شود، یک واحد به شمار درخواست همان کلید اضافه می‌کند.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-base font-black">ارسال پیام</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Code>POST /api/bot/send</Code> پیامی از طرف ربات در گفتگوی هنرجو می‌سازد. بدنه JSON:
        </p>
        <ul className="list-disc space-y-1 pe-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            <Code>userId</Code> شناسهٔ عددی هنرجو. لازم است.
          </li>
          <li>
            <Code>text</Code> متن پیام. لازم است و نباید خالی باشد.
          </li>
          <li>
            <Code>buttons</Code> آرایهٔ دکمه‌ها. هر عضو شیئی با فیلد <Code>text</Code> است. در گفتگو، زدن دکمه همان متن را به عنوان پیام هنرجو برای ربات می‌فرستد.
          </li>
        </ul>
        <p className="text-sm leading-relaxed text-muted-foreground">
          پاسخ موفق: <Code>{`{ "messageId": 123 }`}</Code>. اگر <Code>userId</Code> یا <Code>text</Code> نباشد، وضعیت ۴۰۰ و پیام «userId و text لازم است».
        </p>
        <Example
          title="نمونه"
          code={`curl -X POST /api/bot/send \\
  -H 'Content-Type: application/json' \\
  -H 'X-Bot-Token: YOUR_TOKEN' \\
  -d '{"userId":12,"text":"سلام","buttons":[{"text":"باشه"}]}'`}
        />
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-base font-black">خواندن پاسخ‌ها</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Code>GET /api/bot/updates</Code> صف پاسخ‌هایی را برمی‌گرداند که هنرجو برای این ربات فرستاده است؛ چه متن آزاد، چه متن یک دکمه.
          پارامتر <Code>offset</Code> آخرین شناسه‌ای است که قبلاً دیده‌اید. فقط ردیف‌های با <Code>id</Code> بزرگ‌تر برمی‌گردند، حداکثر ۵۰ تا. اگر نفرستید، از صفر شروع می‌شود.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          پاسخ: <Code>{`{ "updates": [ { "id": 1, "payload": { "from": 12, "name": "نام", "text": "جواب" }, "createdAt": "..." } ] }`}</Code>.
          <Code>from</Code> شناسهٔ فرستنده است، <Code>name</Code> نام او و <Code>text</Code> متن پیام. اگر چیزی نباشد، <Code>updates</Code> آرایهٔ خالی است.
        </p>
      </section>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code dir="ltr" className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">
      {children}
    </code>
  );
}

function Example({ title, code }: { title: string; code: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-muted-foreground">{title}</p>
      <pre dir="ltr" className="overflow-x-auto rounded-2xl border border-border bg-muted/40 p-3 text-left font-mono text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
