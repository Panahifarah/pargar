"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { softPage } from "@/lib/motion";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const first = useRef(true);

  if (first.current) {
    first.current = false;
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={softPage}
    >
      {children}
    </motion.div>
  );
}
