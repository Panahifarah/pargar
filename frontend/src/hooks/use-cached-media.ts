"use client";

import { useEffect, useState } from "react";
import { mediaObjectKey } from "@/lib/media";
import { loadCachedMedia } from "@/lib/transfer";

/** Local bytes for an image or similar object. A replacement has a new key and loads again. Video is not cached. */
export function useCachedObjectUrl(url: string, cacheable = true): string {
  const key = mediaObjectKey(url);
  const [local, setLocal] = useState("");

  useEffect(() => {
    if (!cacheable || !url) {
      setLocal("");
      return;
    }
    let dead = false;
    let objectUrl = "";
    void loadCachedMedia(url)
      .then((blob) => {
        if (dead) return;
        objectUrl = URL.createObjectURL(blob);
        setLocal(objectUrl);
      })
      .catch(() => {
        if (!dead) setLocal(url);
      });
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheable, key, url]);

  if (!cacheable) return url;
  return local;
}
