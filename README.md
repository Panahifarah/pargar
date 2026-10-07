# Pargar

A gated LMS for bootcamps: verified watch → quiz with hearts → skill-tree unlock → mentor chat, events, weekly league, monthly challenges, and certificates.

| Layer | Stack |
|-------|--------|
| API | Go 1.27+ · Postgres · Redis · S3/RustFS · WebSocket |
| UI | Next.js 15 · React Query · Tailwind · Vazirmatn FD |
| Edge | Traefik v3.7 (Compose and k3s) |

## Quick start (local)

```bash
cp .env.example .env          # fill in real secrets
./scripts/compose-dev.sh up -d --build
```

- App: **https://localhost** (Traefik default cert → one browser warning is expected)
- Traefik dashboard: http://127.0.0.1:8088
- Health: `curl -k https://localhost/api/health`

k3s:

```bash
./scripts/k3s-load-images.sh
./scripts/helm-k3s.sh
curl -k https://pargar.local/api/health
```

Deployment details: [docs/deployment.md](docs/deployment.md)

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/README.md](docs/README.md) | Doc index and reading map |
| [docs/architecture.md](docs/architecture.md) | System architecture and data flow |
| [docs/product.md](docs/product.md) | Student / admin paths and features |
| [docs/development.md](docs/development.md) | Development, tests, code conventions |
| [docs/deployment.md](docs/deployment.md) | Compose · Helm/k3s · production |
| [docs/security.md](docs/security.md) | Auth, secrets, rate limits, uploads |
| [docs/operations.md](docs/operations.md) | Backup, metrics, troubleshooting |
| [docs/api.md](docs/api.md) | API contract and key routes |
| [docs/configuration.md](docs/configuration.md) | Environment variable reference |

Domain summary for agents: [CONTEXT.md](CONTEXT.md)

## Repository layout

```text
backend/          Go API, migrations, seed, media/sample.mp4
frontend/         Next.js App Router
deploy/           Compose + Traefik + Helm chart
scripts/          compose / k3s / backup / regenerate-sample
docs/             engineering documentation
```

## Tests

```bash
cd backend && go test ./internal/api/... ./internal/config/...
cd frontend && bunx tsc --noEmit
```

## License

This project is released under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
