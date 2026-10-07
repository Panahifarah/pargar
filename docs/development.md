# Development

## Prerequisites

- Docker + Compose
- Go (aligned with the backend Dockerfile; currently 1.27-alpine)
- Node 22+ / bun for the frontend (image builds use `npm ci`)
- Optional: k3s, Helm 3/4, kubectl, ffmpeg (only to regenerate the sample video)

## Local run (recommended)

```bash
cp .env.example .env
# Fill POSTGRES_PASSWORD, REDIS_PASSWORD, RUSTFS_*, JWT_SECRET, ADMIN_PASSWORD
./scripts/compose-dev.sh up -d --build
```

Equivalent:

```bash
docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.dev.yaml --env-file .env up -d --build
```

The root `docker-compose.yml` includes the same pair.

For UI iteration without rebuilding the image, run `bun run dev` inside `frontend/` and keep `PUBLIC_URL` / `FRONTEND_ORIGINS` aligned; the standard path is still behind Traefik.

## Code structure

- Copy naming and patterns from sibling files; do not invent new top-level folders without agreement.
- Backend tests use Go `testing`; frontend typechecks with `tsc`.
- Frontend calls the API mainly via `http` / `@/lib/api`.

## Tests

```bash
# With Postgres/Redis available (compose) and a correct REDIS_URL
cd backend
export GOTMPDIR="${GOTMPDIR:-$HOME/.cache/go-tmp}"
go test ./internal/config/ -count=1
go test ./internal/api/ -count=1
# or filter:
go test ./internal/api/ -count=1 -run 'TestPasswordRecovery|TestSessionCookie|TestAdminEvent'

cd ../frontend
bunx tsc --noEmit
```

Note: if Redis has a password, build `REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379` from `.env`.

## Seed and sample video

- `SEED_CURRICULUM=true` seeds curriculum/events at startup.
- `backend/media/sample.mp4` is tracked in git; the Docker image copies it; startup PutObjects if the key is missing.
- Regenerate a corrupted file with `./scripts/regenerate-sample-mp4.sh` (needs ffmpeg; not a runtime dependency).

## UI error contract

- Empty list ≠ network error: show error UI + retry.
- Mutations: `toUserError`.
- Player: no infinite skeleton; explicit error state.

## Fonts

- Persian body: **Vazirmatn FD** (Persian digits)
- Latin fields (password, username, captcha): regular Vazirmatn / `font-latin`
