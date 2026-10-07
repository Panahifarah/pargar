"use client";

import { apiForm, toUserError } from "@/lib/api";
import type { User } from "@/lib/types";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const ALLOWED_MIME = new Set(["video/mp4", "video/webm"]);

/** Client-side gate before hitting the network. Prefers MP4. */
export function validateVideoFile(file: File): string | null {
  if (!file || file.size <= 0) {
    return "فایل خالی است.";
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return "حجم ویدیو باید کمتر از ۲۰۰ مگابایت باشد.";
  }

  const name = file.name.toLowerCase().trim();
  const isMp4 = name.endsWith(".mp4");
  const isWebm = name.endsWith(".webm");
  if (!isMp4 && !isWebm) {
    return "فقط فایل‌های MP4 یا WebM مجاز است (ترجیحاً MP4).";
  }

  const mime = (file.type || "").toLowerCase().split(";")[0].trim();
  if (mime && mime !== "application/octet-stream" && !ALLOWED_MIME.has(mime)) {
    return "نوع فایل پشتیبانی نمی‌شود؛ MP4 یا WebM بفرستید.";
  }
  if (mime === "video/mp4" && isWebm) {
    return "پسوند و نوع فایل هم‌خوان نیست.";
  }
  if (mime === "video/webm" && isMp4) {
    return "پسوند و نوع فایل هم‌خوان نیست.";
  }

  return null;
}

/** Multipart upload that quietly refreshes the session on 401. */
export async function uploadVideo(
  lessonHint: number,
  file: File
): Promise<{ url: string; key: string; size: number; mime?: string }> {
  const invalid = validateVideoFile(file);
  if (invalid) {
    throw new Error(invalid);
  }

  try {
    const form = new FormData();
    form.append("file", file);
    return await apiForm<{ url: string; key: string; size: number; mime?: string }>(
      `/api/admin/videos?lesson=${lessonHint}`,
      form
    );
  } catch (err) {
    throw new Error(toUserError(err, "آپلود ویدیو ممکن نشد"));
  }
}

export function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export type { User };
