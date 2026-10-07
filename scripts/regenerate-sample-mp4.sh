#!/usr/bin/env bash
# Regenerate backend/media/sample.mp4 (SMPTE color bars, 45s, 1280x720 H.264).
# Recovery only — runtime does not depend on ffmpeg.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/backend/media/sample.mp4"
mkdir -p "$(dirname "$OUT")"
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found" >&2
  exit 1
fi
ffmpeg -y -f lavfi -i smptebars=size=1280x720:rate=24 \
  -f lavfi -i "sine=frequency=1000:sample_rate=44100" \
  -t 45 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT"
echo "Wrote $OUT"
