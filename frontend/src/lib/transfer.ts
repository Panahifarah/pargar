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

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function uniqueZipName(name: string, used: Map<string, number>): string {
  const base = (name || "file").split(/[/\\]/).pop() || "file";
  const clean = base.replace(/[^\w.\-\u0600-\u06FF ]+/g, "_").slice(0, 80) || "file";
  const n = used.get(clean) ?? 0;
  used.set(clean, n + 1);
  if (n === 0) return clean;
  const dot = clean.lastIndexOf(".");
  if (dot > 0) return `${clean.slice(0, dot)}-${n + 1}${clean.slice(dot)}`;
  return `${clean}-${n + 1}`;
}

/** Uncompressed zip so several chat files save as one download. */
function buildStoredZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.data);
    const cen = new Uint8Array(46 + name.length);
    const cenView = new DataView(cen.buffer);
    cenView.setUint32(0, 0x02014b50, true);
    cenView.setUint16(4, 20, true);
    cenView.setUint16(6, 20, true);
    cenView.setUint16(8, 0x800, true);
    cenView.setUint16(10, 0, true);
    cenView.setUint16(12, dosTime, true);
    cenView.setUint16(14, dosDate, true);
    cenView.setUint32(16, crc, true);
    cenView.setUint32(20, file.data.length, true);
    cenView.setUint32(24, file.data.length, true);
    cenView.setUint16(28, name.length, true);
    cenView.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const parts = [...locals, ...central, end].map((part) => {
    const copy = new ArrayBuffer(part.byteLength);
    new Uint8Array(copy).set(part);
    return copy;
  });
  return new Blob(parts, { type: "application/zip" });
}

/** Save every file in one zip. */
export async function downloadAllAsZip(
  items: { url: string; name: string }[],
  archiveName: string,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const used = new Map<string, number>();
  const files: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < items.length; i++) {
    onProgress?.(i / Math.max(items.length, 1));
    const hit = await readCachedMedia(items[i].url);
    const blob = hit ?? (await fetchBlob(items[i].url));
    if (!hit) await writeCachedMedia(items[i].url, blob);
    files.push({ name: uniqueZipName(items[i].name, used), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  onProgress?.(1);
  triggerDownload(buildStoredZip(files), archiveName || "files.zip");
}

/** One network fetch per object. Later views reuse the saved bytes until the object is replaced. */
export async function clearMediaCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(mediaCacheName);
}

export async function loadCachedMedia(url: string): Promise<Blob> {
  const hit = await readCachedMedia(url);
  if (hit) return hit;
  const blob = await fetchBlob(url);
  await writeCachedMedia(url, blob);
  return blob;
}
