"use client";

import React from "react";
import { MotionConfig } from "framer-motion";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster, toast } from "sonner";
import { ErrorBoundary } from "@/components/error-boundary";
import { queryClient } from "@/lib/query-client";
import { softTween } from "@/lib/motion";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <MotionConfig reducedMotion="user" transition={softTween}>
          <ErrorBoundary area="app">{children}</ErrorBoundary>
        </MotionConfig>
        <Toaster
          position="top-center"
          richColors
          offset={76}
          mobileOffset={{ top: "4.25rem", left: "0.75rem", right: "0.75rem" }}
          closeButton
          toastOptions={{ duration: 4000 }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export { toast };
