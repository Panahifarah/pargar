"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-store";
import { http } from "@/lib/api";
import type { User } from "@/lib/types";

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
    if (!fresh || !user) return;
    if (
      fresh.id === user.id &&
      fresh.name === user.name &&
      fresh.email === user.email &&
      fresh.role === user.role &&
      fresh.xp === user.xp &&
      fresh.hearts === user.hearts &&
      fresh.streakCurrent === user.streakCurrent &&
      fresh.streakLongest === user.streakLongest &&
      fresh.isLocked === user.isLocked &&
      fresh.isActive === user.isActive &&
      fresh.avatarVariant === user.avatarVariant &&
      fresh.avatarPalette === user.avatarPalette &&
      fresh.avatarPhoto === user.avatarPhoto
    ) {
      return;
    }
    setUser(fresh);
  }, [data, user, setUser]);

  return data?.user ?? user;
}