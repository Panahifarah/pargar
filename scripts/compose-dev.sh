#!/usr/bin/env bash
# Dev / laptop stack (Traefik + localhost TLS + published DB ports).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and fill secrets." >&2
  exit 1
fi

exec docker compose \
  -f deploy/compose/compose.yaml \
  -f deploy/compose/compose.dev.yaml \
  --env-file .env \
  "$@"
