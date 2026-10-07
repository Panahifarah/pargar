#!/usr/bin/env bash
# Production compose stack (Traefik + Let's Encrypt). Never use DEV_MODE=true here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.prod}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy .env.prod.example and fill production secrets/DNS." >&2
  exit 1
fi

# Guardrails
if grep -Eq '^[[:space:]]*DEV_MODE[[:space:]]*=[[:space:]]*true' "$ENV_FILE"; then
  echo "Refusing to start: DEV_MODE=true in $ENV_FILE" >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*ACME_EMAIL[[:space:]]*=' "$ENV_FILE"; then
  echo "Refusing to start: ACME_EMAIL must be set in $ENV_FILE" >&2
  exit 1
fi

exec docker compose \
  -f deploy/compose/compose.yaml \
  -f deploy/compose/compose.prod.yaml \
  --env-file "$ENV_FILE" \
  "$@"
