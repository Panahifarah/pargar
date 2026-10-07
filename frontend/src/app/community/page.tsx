"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Shortcut so /community never 404s. */
export default function CommunityRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/unwrap?tab=community");
  }, [router]);
  return null;
}
