import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { PageTransition } from "@/components/page-transition";

/** Vazirmatn FD — default UI; Latin digits render as Persian glyphs. */
const vazirmatnFd = localFont({
  src: [
    { path: "./fonts/Vazirmatn-FD-Thin.woff2", weight: "100", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-ExtraLight.woff2", weight: "200", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "./fonts/Vazirmatn-FD-Black.woff2", weight: "900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-vazirmatn",
  fallback: ["Tahoma", "Segoe UI", "Arial", "sans-serif"],
});

/** Plain Vazirmatn — Latin digits stay Latin (passwords, usernames, captcha, URLs…). */
const vazirmatnLatin = localFont({
  src: "./fonts/Vazirmatn-Variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-vazirmatn-latin",
  fallback: ["Tahoma", "Segoe UI", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "پرگار",
  description: "مسیر یادگیری واقعی پرگار",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatnFd.variable} ${vazirmatnLatin.variable}`}
      suppressHydrationWarning
    >
      <body
        className={`${vazirmatnFd.className} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <Providers>
          <AppShell>
            <PageTransition>{children}</PageTransition>
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
