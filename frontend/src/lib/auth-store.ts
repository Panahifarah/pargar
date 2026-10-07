"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "./types";
import { queryClient } from "./query-client";

interface AuthState {
  user: User | null;
  /** In-memory only — never persisted (httpOnly cookies hold the session). */
  accessToken: string | null;
  refreshToken: string | null;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  setSession: (access: string, refresh: string, user: User) => void;
  setUser: (user: User) => void;
  setTokens: (access: string, refresh: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      setSession: (accessToken, refreshToken, user) =>
        set({ accessToken, refreshToken, user }),
      setUser: (user) => set({ user }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      clear: () => {
        queryClient.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },
    }),
    {
      name: "pargar.auth",
      // Persist identity only — tokens live in httpOnly cookies + memory.
      partialize: (s) => ({
        user: s.user,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>;
        return {
          ...current,
          ...p,
          // Drop any legacy tokens that may still be in older localStorage blobs.
          accessToken: null,
          refreshToken: null,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export function useAuthHydrated() {
  return useAuth((s) => s._hasHydrated);
}
