"use client";

import { toast } from "sonner";
import { useAuth } from "./auth-store";

/** Empty string = same-origin (production behind reverse proxy). */
function resolveApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv.replace(/\/$/, "");
  }
  return "";
}

const API = resolveApiBase();

const RATE_LIMIT_TOAST_ID = "api-rate-limit";
const RATE_LIMIT_FALLBACK = "تعداد درخواست‌ها زیاد است؛ لطفاً کمی صبر کنید";

export type ApiErrorBody = {
  error?: string;
  code?: string;
  requestId?: string;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(message: string, status: number, opts?: { code?: string; requestId?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = opts?.code;
    this.requestId = opts?.requestId;
  }
}

function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return Math.random().toString(16).slice(2, 18);
}

/** Show/update a single rate-limit toast — never logs the user out. */
export function notifyRateLimit(message?: string): void {
  const msg = message?.trim() || RATE_LIMIT_FALLBACK;
  toast.error(msg, { id: RATE_LIMIT_TOAST_ID, duration: 6_000 });
}

async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  const requestId = res.headers.get("X-Request-ID") ?? undefined;
  try {
    const body = (await res.json()) as ApiErrorBody;
    return {
      error: body?.error ? String(body.error) : undefined,
      code: body?.code ? String(body.code) : undefined,
      requestId: body?.requestId ? String(body.requestId) : requestId,
    };
  } catch {
    return { requestId };
  }
}

function throwHttpError(status: number, body: ApiErrorBody, fallback: string): never {
  const message = body.error?.trim() || fallback;
  if (status === 429) {
    notifyRateLimit(message);
  }
  throw new ApiError(message, status, { code: body.code, requestId: body.requestId });
}

/** Turn a failed fetch Response into ApiError (for raw fetch call sites). */
export async function throwFromResponse(res: Response, fallback?: string): Promise<never> {
  const body = await readErrorBody(res);
  throwHttpError(res.status, body, fallback ?? `Request failed (${res.status})`);
}

/** Map any thrown value to a concise Persian user-facing message. */
export function toUserError(err: unknown, fallback = "خطایی رخ داد؛ دوباره تلاش کنید"): string {
  if (err instanceof ApiError) {
    const msg = err.message?.trim();
    switch (err.status) {
      case 401: {
        if (msg && msg !== "session expired" && msg !== "no session") {
          return msg;
        }
        return "نشست منقضی شده؛ دوباره وارد شوید.";
      }
      case 403:
        return msg || "دسترسی کافی ندارید.";
      case 404:
        return msg || "مورد درخواستی پیدا نشد.";
      case 409:
        return msg || "این عملیات با وضعیت فعلی در تعارض است.";
      case 413:
        return msg || "حجم فایل بیش از حد مجاز است.";
      case 423:
        return msg || "حساب شما محدود شده است.";
      case 429:
        return msg || RATE_LIMIT_FALLBACK;
      default:
        break;
    }
    if (err.status >= 500) {
      const base = msg || "مشکل موقتی سرور؛ کمی بعد دوباره تلاش کنید.";
      return err.requestId ? `${base} (کد پیگیری: ${err.requestId})` : base;
    }
    return msg || fallback;
  }
  if (err instanceof TypeError) {
    return "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.";
  }
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (!msg) return fallback;
    if (msg === "session expired" || msg === "no session") {
      return "نشست منقضی شده؛ دوباره وارد شوید.";
    }
    if (msg === "Failed to fetch" || msg.includes("NetworkError") || msg.includes("Load failed")) {
      return "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.";
    }
    return msg;
  }
  return fallback;
}

/** Toast a background/query failure without spamming auth/not-found noise. */
export function notifyQueryError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403 || err.status === 404) return;
    if (err.status === 429) return; // already toasted
    const id = err.requestId
      ? `query-err-${err.requestId}`
      : `query-err-${err.status}-${err.code ?? "x"}`;
    toast.error(toUserError(err), { id, duration: 6_000 });
    return;
  }
  toast.error(toUserError(err), { id: "query-network", duration: 6_000 });
}

let refreshInFlight: Promise<void> | null = null;

export async function refreshSession(): Promise<void> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    const { refreshToken, setSession, user } = useAuth.getState();
    // Cookie session may refresh without an in-memory refresh token.
    if (!refreshToken && !user) {
      useAuth.getState().clear();
      throw new ApiError("no session", 401, { code: "unauthorized" });
    }
    const requestId = newClientRequestId();
    const res = await fetch(`${API}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
      },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
    if (!res.ok) {
      const body = await readErrorBody(res);
      if (res.status === 429) {
        throwHttpError(429, body, RATE_LIMIT_FALLBACK);
      }
      useAuth.getState().clear();
      throw new ApiError("session expired", 401, {
        code: body.code ?? "unauthorized",
        requestId: body.requestId ?? requestId,
      });
    }
    const data = await res.json();
    setSession(data.accessToken, data.refreshToken, data.user);
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function authHeaders(token: string | null, requestId: string, json: boolean): HeadersInit {
  return {
    "X-Request-ID": requestId,
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Authenticated JSON fetch with silent token refresh. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const { accessToken } = useAuth.getState();
  const requestId = newClientRequestId();
  const doFetch = (token: string | null) =>
    fetch(`${API}${path}`, {
      method: opts.method ?? "GET",
      credentials: "include",
      headers: authHeaders(token, requestId, true),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

  let res = await doFetch(accessToken);
  if (res.status === 401 && (useAuth.getState().refreshToken || useAuth.getState().user)) {
    await refreshSession();
    res = await doFetch(useAuth.getState().accessToken);
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    throwHttpError(res.status, body, `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const API_URL = API;

/** WebSocket URL: env override, else same-host /api/ws (ws/wss from page protocol). */
export function getWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) {
    return fromEnv;
  }
  if (typeof window === "undefined") {
    return "ws://localhost:8080/api/ws";
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

// ---- endpoint helpers (typed) ----
export const http = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => api<T>(path, { method: "DELETE" }),
};

/** Authenticated multipart upload with silent token refresh. */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const { accessToken } = useAuth.getState();
  const requestId = newClientRequestId();
  const doFetch = (token: string | null) =>
    fetch(`${API}${path}`, {
      method: "POST",
      credentials: "include",
      headers: authHeaders(token, requestId, false),
      body: form,
    });

  let res = await doFetch(accessToken);
  if (res.status === 401 && (useAuth.getState().refreshToken || useAuth.getState().user)) {
    await refreshSession();
    res = await doFetch(useAuth.getState().accessToken);
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    throwHttpError(res.status, body, `Upload failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Resolve a signed media URL for a storage key (authenticated). */
export async function signedMediaUrl(key: string): Promise<string> {
  const { url } = await http.get<{ url: string }>(`/api/media/sign?key=${encodeURIComponent(key)}`);
  return url;
}
