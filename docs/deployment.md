# Deployment

Fuller command reference: [`deploy/README.md`](../deploy/README.md). This document covers deployment models and production requirements.

## Options

| Environment | Tooling | TLS | Data |
|-------------|---------|-----|------|
| Laptop | Compose + `compose.dev.yaml` | Traefik default cert | Postgres/Redis/RustFS in compose |
| Single-host VPS | Compose + `compose.prod.yaml` | Let's Encrypt HTTP-01 | Same + no published DB ports |
| Local k3s | Helm `values-k3s.yaml` | Chart self-signed | In-cluster |
| Production K8s | Helm `values-prod.yaml` | cert-manager | Usually external DB/Redis/S3 |

## Routing

| Path | Service |
|------|---------|
| `/api/*`, `/media/*` | backend |
| `/api/certificates/*`, `/c/*` | backend (+ noindex middleware) |
| everything else | frontend |
| `/api/ws` | backend WebSocket via Traefik |

## Compose — development

```bash
cp .env.example .env
./scripts/compose-dev.sh up -d --build
```

- App: https://localhost
- Traefik dashboard: http://127.0.0.1:8088
- DB ports only on `127.0.0.1`

## Compose — production

```bash
cp .env.prod.example .env.prod
./scripts/compose-prod.sh up -d --build
```

DNS must point at the host. `DOMAIN`, `ACME_EMAIL`, and strong secrets are required.

## k3s + Helm

```bash
# Install k3s and kubeconfig once (see deploy/README.md)
./scripts/k3s-load-images.sh    # build and import local images
./scripts/helm-k3s.sh           # upgrade --install with values-k3s.yaml
echo "127.0.0.1 pargar.local" | sudo tee -a /etc/hosts   # if needed
curl -k https://pargar.local/api/health
```

### Values

| File | Purpose |
|------|---------|
| `deploy/helm/pargar/values.yaml` | Defaults |
| `values-k3s.yaml` | Local: seed, backup CronJob, self-signed TLS |
| `values-prod.yaml` | Registry, HPA, PDB, NetworkPolicy, `existingSecret` |

```bash
helm lint ./deploy/helm/pargar -f ./deploy/helm/pargar/values-k3s.yaml
helm template pargar ./deploy/helm/pargar -f ./deploy/helm/pargar/values-k3s.yaml
```

Helm 4 rejects negation patterns in `.helmignore` (`!…`); do not add them.

### Chart secrets

- Without `backend.existingSecret`: the chart generate-once via `lookup` + `randAlphaNum` and keeps values across upgrades.
- `change-me-*` placeholders in values are ignored.
- An existing Postgres password is **never rotated** (data depends on it).
- Production: always pre-create the Secret and set `backend.existingSecret`.

Read a generated admin password:

```bash
kubectl -n pargar get secret pargar-app -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

### DB/Redis wiring in Helm

Instead of a raw URL with an unencoded password, the backend builds from parts:

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_HOST` / `POSTGRES_DB` / `POSTGRES_SSLMODE`
- `REDIS_HOST` / `REDIS_PASSWORD`

Or for external production: `DATABASE_URL` / `REDIS_URL` inside the Secret.

### In-cluster backup

With `postgres.enabled` and `backup.enabled=true` (on for k3s): daily CronJob `pg_dump | gzip` onto a PVC with retention. For managed Postgres in production, set `backup.enabled=false`.

## Production checklist

1. `DEV_MODE=false`
2. Strong `JWT_SECRET` and `ADMIN_PASSWORD` (no placeholders) — otherwise `config.Validate()` refuses to boot
3. Exact public `PUBLIC_URL` and `FRONTEND_ORIGINS`
4. `TRUSTED_PROXY_CIDRS` limited to the proxy network
5. `METRICS_TOKEN` to expose `/metrics`
6. Images from a private registry + `imagePullSecrets`
7. cert-manager / real TLS
8. DB and object-storage backups defined
9. `PHYSICAL_CERT_ENABLED` only if the offline payment process is ready
10. NetworkPolicy / HPA per `values-prod.yaml`
