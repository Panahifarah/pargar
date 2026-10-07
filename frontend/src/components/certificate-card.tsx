"use client";

import Link from "next/link";
import { Award, Copy } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/providers";

export type CertificateCardData = {
  publicId: string;
  fullName: string;
  issuedAt: string;
  course: string;
};

export function CertificateCard({
  cert,
  showOwnerLinks = false,
  children,
}: {
  cert: CertificateCardData;
  showOwnerLinks?: boolean;
  children?: React.ReactNode;
}) {
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("لینک گواهینامه کپی شد");
    } catch {
      toast.error("کپی ممکن نشد");
    }
  };

  return (
    <div className="relative mx-auto min-h-[70vh] max-w-2xl px-4 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      <div className="rounded-2xl border-2 border-border bg-card p-8 shadow-soft sm:p-10">
        <div className="flex flex-col items-center text-center">
          <Award className="mb-4 h-12 w-12 text-primary" />
          <BrandMark locale="fa" size="lg" />
          <p className="section-kicker mt-6">گواهینامه پایان دوره</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{cert.fullName}</h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            با موفقیت دوره {cert.course} را به پایان رسانده و همه درس‌های فعال را پاس کرده‌اند.
          </p>
          <p className="mt-6 text-xs text-muted-foreground">
            تاریخ صدور: {new Date(cert.issuedAt).toLocaleDateString("fa-IR")}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground" dir="ltr">
            تأیید: {cert.publicId}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void copyLink()}>
              <Copy className="h-3.5 w-3.5" /> کپی لینک
            </Button>
            {showOwnerLinks && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/cap">درخت مهارت</Link>
              </Button>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
