# Configuration

Templates: [`.env.example`](../.env.example) (Compose dev), [`.env.prod.example`](../.env.prod.example) (Compose prod). In Kubernetes, values come from Secret / chart values.

## Required in production (`DEV_MODE=false`)

| Variable | Notes |
|----------|--------|
| `JWT_SECRET` | ≥32 characters; not a placeholder |
| `ADMIN_PASSWORD` | Strong; only for initial missing-admin bootstrap |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | When `STORAGE_DRIVER=s3` |
| `PUBLIC_URL` | Public origin with scheme |
| `FRONTEND_ORIGINS` | CSV of allowed CORS origins |

`config.Validate()` fails boot if secrets look like `change-me` / `local-dev-only`.

## Database and Redis

One of two patterns:

**A) Ready-made URLs**

- `DATABASE_URL`
- `REDIS_URL`

**B) Parts (Helm in-cluster)** — URL is built with correct encoding:

| Variable | Conceptual default |
|----------|--------------------|
| `POSTGRES_USER` | pargar |
| `POSTGRES_PASSWORD` | — |
| `POSTGRES_HOST` | postgres service |
| `POSTGRES_PORT` | 5432 |
| `POSTGRES_DB` | pargar |
| `POSTGRES_SSLMODE` | disable |
| `REDIS_HOST` | redis service |
| `REDIS_PORT` | 6379 |
| `REDIS_PASSWORD` | — |
| `REDIS_DB` | optional |

## Storage

| Variable | Notes |
|----------|--------|
| `STORAGE_DRIVER` | `s3` (default prod/compose) or local in tests |
| `STORAGE_ENDPOINT` | e.g. `http://rustfs:9000` |
| `STORAGE_REGION` | us-east-1 |
| `STORAGE_BUCKET` | pargar |
| `STORAGE_DIR` | Local driver only |

## Admin bootstrap

| Variable | Notes |
|----------|--------|
| `ADMIN_NAME` | Display name |
| `ADMIN_USERNAME` | e.g. admin |
| `ADMIN_EMAIL` | Login identity |
| `ADMIN_PASSWORD` | Applied only if the admin user does not exist |

## Product behavior

| Variable | Logical default | Notes |
|----------|-----------------|--------|
| `DEV_MODE` | false | Open metrics without token, limited fail-open behavior |
| `SEED_CURRICULUM` | false (empty in DevMode → true) | Seed lessons/events |
| `CAPTCHA_EXPOSE_ANSWER` | DevMode only | For tests; never in production |
| `DONATION_ENABLED` | true | Support card |
| `DONATION_NOTE` | Copy text | |
| `PHYSICAL_CERT_ENABLED` | false in config/chart | Physical certificate |
| `PHYSICAL_CERT_PRICE_IRR` | 2500000 | |
| `PHYSICAL_CERT_WINDOW_DAYS` | 30 | |
| `HEART_REGEN_HOURS` | 4 | |

Many boolean/text settings can later be overridden from Admin → site settings (`app_settings`).

## Network and observability

| Variable | Notes |
|----------|--------|
| `DOMAIN` | Traefik Host (Compose) |
| `TRUSTED_PROXY_CIDRS` | CSV of networks trusted for X-Forwarded-* |
| `METRICS_TOKEN` | Guards `/metrics` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Empty = off |
| `OTEL_SERVICE_NAME` | pargar-api |
| `PORT` | 8080 |

## Frontend

| Build variable | Notes |
|----------------|--------|
| `NEXT_PUBLIC_API_URL` | Empty = same-origin |
| `NEXT_PUBLIC_WS_URL` | Empty = `ws(s)://host/api/ws` |

## Helm (summary)

See `deploy/helm/pargar/values.yaml`:

- `global.domain` / `publicUrl` / `frontendOrigins` / `trustedProxyCIDRs`
- `backend.env.*` → container env
- Empty `backend.secrets` → generate-once
- `backup.*` → CronJob
- `postgres` / `redis` / `rustfs` or `external.*`
