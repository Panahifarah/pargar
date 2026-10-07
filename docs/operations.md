# Operations

## Health

```bash
curl -k "$PUBLIC_URL/api/health"    # {"status":"ok"}
kubectl -n pargar get pods,ingressroute,svc
kubectl -n pargar logs deploy/pargar-backend --tail=100
```

## Backup

### Compose

```bash
./scripts/backup.sh [outdir]
```

Output: `postgres.sql.gz` + RustFS data archive (when possible).

### Helm / k3s

With `backup.enabled=true`:

- CronJob `pargar-pg-backup` on `backup.schedule` (default daily 03:00 UTC)
- Files on PVC `pargar-backups`
- Auto-delete older than `backup.retentionDays`

Manual restore (summary):

```bash
# Example: copy dump from pod/PVC then
gunzip -c pargar-YYYYMMDD.sql.gz | psql "$DATABASE_URL"
```

Back up object storage separately (bucket versioning / RustFS PVC snapshot).

## Metrics and tracing

- `GET /metrics` — without `METRICS_TOKEN` and outside DevMode → 404
- Header `X-Metrics-Token` or `Authorization: Bearer …`
- OTLP: `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_SERVICE_NAME`

## Updating images on k3s

```bash
./scripts/k3s-load-images.sh
./scripts/helm-k3s.sh
kubectl -n pargar rollout restart deploy/pargar-backend deploy/pargar-frontend
kubectl -n pargar rollout status deploy/pargar-backend
```

The `local` tag uses `IfNotPresent`; always restart after import.

## Common troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Seed video will not play | `sample.mp4` missing in storage | Check `sample media` logs; ensure file is in the image; restart backend |
| Sudden 401 after upgrade | JWT secret changed | Do not rotate the secret unless intentional; users must log in again |
| Backend CrashLoop after changing DB password in Secret | Old PVC password ≠ new Secret | Restore previous Secret password or re-seed DB |
| Repeated 429 | Rate limit | Wait; honor `Retry-After`; DevMode behaves differently |
| Empty CAPTCHA in tests | `CAPTCHA_EXPOSE_ANSWER` only with DevMode | Tests set both true |
| Helm lint/template differs from cluster | `lookup` empty without API | Install/upgrade against a real cluster |
| Frontend does not show changes | Stale image | Rebuild + import + rollout restart |

## Logging

- Requests with `request_id`, `user_id`, status, duration
- Security events: login, recovery, password reset, …
- Critical-path internals: `writeInternalErr` (log cause, generic user message)

## Useful scripts

| Script | Purpose |
|--------|---------|
| `scripts/compose-dev.sh` | Development Compose |
| `scripts/compose-prod.sh` | Production Compose |
| `scripts/k3s-load-images.sh` | Build + import into k3s containerd |
| `scripts/helm-k3s.sh` | helm upgrade --install |
| `scripts/backup.sh` | Compose backup |
| `scripts/regenerate-sample-mp4.sh` | Rebuild color bars with ffmpeg |
