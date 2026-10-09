import { useAuth } from "./auth-store";
import { ApiError, refreshSession, throwFromResponse } from "./api";
import { mediaObjectKey } from "./media";

const mediaCacheName = "pargar-media-v1";

function apiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv.replace(/\/$/, "");
  return "";
}

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return Math.random().toString(16).slice(2, 18);
}

async function refreshOnce(): Promise<string | null> {
  await refreshSession();
  return useAuth.getState().accessToken;
}

type XHRResult = { status: number; body: string; blob: Blob | null };

function xhrSend(
  method: "GET" | "POST",
  url: string,
  opts: {
    token: string | null;
    body?: FormData;
    responseType: "json" | "blob";
    onProgress?: (ratio: number) => void;
  },
): Promise<XHRResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Request-ID", requestId());
    if (opts.token) xhr.setRequestHeader("Authorization", `Bearer ${opts.token}`);
    xhr.responseType = opts.responseType === "blob" ? "blob" : "text";
    const progress = (e: ProgressEvent) => {
      if (!opts.onProgress) return;
      if (e.lengthComputable && e.total > 0) opts.onProgress(Math.min(1, e.loaded / e.total));
    };
    if (method === "POST") xhr.upload.onprogress = progress;
    else xhr.onprogress = progress;
    xhr.onload = () => {
      resolve({
        status: xhr.status,
        body: opts.responseType === "json" ? String(xhr.response ?? "") : "",
        blob: opts.responseType === "blob" ? (xhr.response as Blob) : null,
      });
    };
    xhr.onerror = () => reject(new ApiError("ارتباط قطع شد", 0));
    xhr.send(opts.body ?? null);
  });
}

/** Multipart upload that reports how full the transfer is. */
export async function apiFormProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (ratio: number) => void,
): Promise<T> {
  const url = `${apiBase()}${path}`;
  const send = (token: string | null) =>
    xhrSend("POST", url, { token, body: form, responseType: "json", onProgress });

  let res = await send(useAuth.getState().accessToken);
  if (res.status === 401 && (useAuth.getState().refreshToken || useAuth.getState().user)) {
    res = await send(await refreshOnce());
  }
  if (res.status < 200 || res.status >= 300) {
    const fake = new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
    await throwFromResponse(fake, `Upload failed (${res.status})`);
  }
  onProgress?.(1);
  return JSON.parse(res.body) as T;
}

/** Download into memory and report fill ratio. Does not open a tab. */
export async function fetchBlob(
  url: string,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const res = await xhrSend("GET", url, { token: null, responseType: "blob", onProgress });
  if (res.status < 200 || res.status >= 300 || !res.blob) {
    throw new ApiError("دانلود ممکن نشد", res.status);
  }
  onProgress?.(1);
  return res.blob;
}

async function mediaCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(mediaCacheName);
  } catch {
    return null;
  }
}

/** Bytes already saved for this object. A new photo, video, or voice is a new key. */
export async function readCachedMedia(url: string): Promise<Blob | null> {
  try {
    const key = mediaObjectKey(url);
    if (!key) return null;
    const cache = await mediaCache();
    const hit = await cache?.match(key);
    if (!hit) return null;
    return hit.blob();
  } catch {
    return null;
  }
}

async function writeCachedMedia(url: string, blob: Blob): Promise<void> {
  try {
    const key = mediaObjectKey(url);
    if (!key) return;
    const cache = await mediaCache();
    if (!cache) return;
    await cache.put(
      key,
      new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }),
    );
  } catch {
    // A failed cache still leaves the file ready to save.
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename || "file";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

/**
 * Save a remote file after it has finished downloading.
 * Image, audio, and other files are kept by object key, so a later save does not fetch again.
 * Video is streamed and is not kept this way.
 */
export async function saveRemoteFile(
  url: string,
  filename: string,
  onProgress?: (ratio: number) => void,
  opts?: { cache?: boolean },
): Promise<void> {
  const cache = opts?.cache !== false;
  if (cache) {
    const hit = await readCachedMedia(url);
    if (hit) {
      onProgress?.(1);
      triggerDownload(hit, filename);
      return;
    }
  }
  const blob = await fetchBlob(url, onProgress);
  if (cache) await writeCachedMedia(url, blob);
  triggerDownload(blob, filename);
}

/** One network fetch per object. Later views reuse the saved bytes until the object is replaced. */
export async function loadCachedMedia(url: string): Promise<Blob> {
  const hit = await readCachedMedia(url);
  if (hit) return hit;
  const blob = await fetchBlob(url);
  await writeCachedMedia(url, blob);
  return blob;
}
