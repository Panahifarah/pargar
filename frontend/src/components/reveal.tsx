"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { softReveal } from "@/lib/motion";

export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, scale: 0.992 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ ...softReveal, delay }}
    >
      {children}
    </motion.div>
  );
}
