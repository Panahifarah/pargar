"use client";

import { Suspense } from "react";
import { AdminStudio } from "@/components/admin-studio";

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminStudio />
    </Suspense>
  );
}