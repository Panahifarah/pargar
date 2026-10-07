"use client";

import { QueryCache, QueryClient, keepPreviousData } from "@tanstack/react-query";
import { notifyQueryError } from "@/lib/api";

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = statusOf(error);
  // Never hammer rate limits or auth/permission failures.
  if (status === 429 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Opt out per-query: meta: { silentError: true }
      if (query.meta && (query.meta as { silentError?: boolean }).silentError) {
        return;
      }
      notifyQueryError(error);
    },
  }),
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      gcTime: 5 * 60_000,
      placeholderData: keepPreviousData,
    },
    mutations: {
      retry: false,
    },
  },
});
