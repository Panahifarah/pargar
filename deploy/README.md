# Pargar deploy

Full deployment guide and production checklist: **[`docs/deployment.md`](../docs/deployment.md)**  
Security & secrets: [`docs/security.md`](../docs/security.md) · Ops / backup: [`docs/operations.md`](../docs/operations.md)

Edge: **Traefik v3.7** (Compose needs Traefik ≥3.6.1 on Docker Engine 29+).

## Layout

```text
deploy/
  compose/
    compose.yaml          # shared app + data + Traefik labels
    compose.dev.yaml      # laptop TLS default, DB ports on 127.0.0.1
    compose.prod.yaml     # Let's Encrypt, no host DB ports
  traefik/dynamic/        # middlewares
  helm/pargar/            # chart + values-k3s / values-prod
scripts/
  compose-dev.sh  compose-prod.sh  k3s-load-images.sh  helm-k3s.sh  backup.sh
```

## Compose — development

```bash
cp .env.example .env
./scripts/compose-dev.sh up -d --build
```

- App: https://localhost
- Traefik dashboard: http://127.0.0.1:8088

## Compose — production

```bash
cp .env.prod.example .env.prod
./scripts/compose-prod.sh up -d --build
```

## k3s + Helm

```bash
./scripts/k3s-load-images.sh
./scripts/helm-k3s.sh
curl -k https://pargar.local/api/health
```

```bash
kubectl -n pargar get secret pargar-app -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

Values: `values.yaml` · `values-k3s.yaml` · `values-prod.yaml`  
Lint: `helm lint ./deploy/helm/pargar -f ./deploy/helm/pargar/values-k3s.yaml`

## Routing

| Path | Service |
|------|---------|
| `/api/*`, `/media/*` | backend |
| `/api/certificates/*`, `/c/*` | backend + noindex |
| else | frontend |

WS: `/api/ws` via Traefik.
