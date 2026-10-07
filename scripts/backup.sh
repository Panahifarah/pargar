#!/usr/bin/env bash
# Backup Postgres + RustFS volume data for pargar.
# Usage: ./scripts/backup.sh [output-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"

echo "Backing up Postgres to $OUT/postgres.sql.gz"
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-pargar}" "${POSTGRES_DB:-pargar}" | gzip > "$OUT/postgres.sql.gz"

echo "Backing up RustFS volume snapshot marker to $OUT"
docker compose -f "$ROOT/docker-compose.yml" exec -T rustfs \
  sh -c 'tar -C /data -czf - .' > "$OUT/rustfs-data.tar.gz" || {
  echo "Note: if rustfs tar failed, copy volume rustfs_data manually" >&2
}

echo "Done: $OUT"
ls -lh "$OUT"
