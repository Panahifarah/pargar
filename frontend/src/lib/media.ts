/** Storage path of a signed /media URL, without the rotating signature. */
export function mediaObjectKey(src: string | null | undefined): string {
  if (!src) return "";
  const cut = src.indexOf("?");
  const path = cut >= 0 ? src.slice(0, cut) : src;
  const i = path.indexOf("/media/");
  return i >= 0 ? path.slice(i) : path;
}
