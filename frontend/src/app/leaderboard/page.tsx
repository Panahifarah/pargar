"use client";

import { Suspense } from "react";
import { Trophy } from "lucide-react";
import { LeaderboardPanel } from "@/components/leaderboard-panel";
import { PageHeader } from "@/components/page-header";

export default function LeaderboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        align="center"
        kicker="رقابت هفتگی"
        title={
          <>
            لیگ <span className="text-gradient-brand">هفتگی</span>
          </>
        }
        description="با تکمیل صادقانه دروس امتیاز بگیرید. لیگ هر دوشنبه صفر می‌شود — استمرار از شدت مهم‌تر است."
        actions={
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Trophy className="h-6 w-6" />
          </span>
        }
      />
      <Suspense fallback={null}>
        <LeaderboardPanel />
      </Suspense>
    </div>
  );
}