"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-store";
import { http } from "@/lib/api";
import type { User } from "@/lib/types";

function sameLiveUser(a: User, b: User): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.email === b.email &&
    a.role === b.role &&
    a.xp === b.xp &&
    a.hearts === b.hearts &&
    a.streakCurrent === b.streakCurrent &&
    a.streakLongest === b.streakLongest &&
    a.isLocked === b.isLocked &&
    a.isFrozen === b.isFrozen &&
    a.isClosed === b.isClosed &&
    a.frozenAt === b.frozenAt &&
    a.closedAt === b.closedAt &&
    a.closesAt === b.closesAt &&
    a.isActive === b.isActive &&
    a.avatarVariant === b.avatarVariant &&
    a.avatarPalette === b.avatarPalette &&
    a.avatarPhoto === b.avatarPhoto
  );
}

export function useLiveUser(): User | null {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);

  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: () => http.get<{ user: User }>("/api/auth/me"),
    enabled: !!user,
    refetchInterval: user ? 60_000 : false,
  });

  useEffect(() => {
    const fresh = data?.user;
    if (!fresh) return;
    const current = useAuth.getState().user;
    if (current && sameLiveUser(fresh, current)) return;
    setUser(fresh);
  }, [data, setUser]);

  // Prefer the auth store. A just-saved avatar must show before the ["me"]
  // cache catches up; applying that stale cache used to put the old photo back.
  return user ?? data?.user ?? null;
}