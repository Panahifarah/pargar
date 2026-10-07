"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { hasInfiniteHearts } from "@/lib/hearts";
import { QuizExperience } from "@/components/quiz-experience";

export default function QuizPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const id = Number(lessonId);
  const router = useRouter();
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (user?.isLocked && !hasInfiniteHearts(user.role)) {
      router.replace("/lockout");
    }
  }, [user?.isLocked, user?.role, router]);

  if (user?.isLocked && !hasInfiniteHearts(user.role)) {
    return null;
  }

  return (
    <div className="pt-2">
      <QuizExperience lessonId={id} />
    </div>
  );
}
