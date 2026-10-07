#!/usr/bin/env bash
# Build compose images and import them into local k3s containerd.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v k3s >/dev/null 2>&1; then
  echo "k3s not found. Install: https://docs.k3s.io/quick-start" >&2
  exit 1
fi

./scripts/compose-dev.sh build backend frontend

echo "Importing images into k3s..."
docker save pargar-backend:local pargar-frontend:local | sudo k3s ctr images import -
echo "Done. Images: pargar-backend:local pargar-frontend:local"
