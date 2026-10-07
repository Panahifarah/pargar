import type { Metadata } from "next";

/** Certificate share links are unlisted — never index or follow. */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function CertificateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
