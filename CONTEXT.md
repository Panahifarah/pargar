# Pargar — domain summary

> Full source of truth: [`docs/`](docs/README.md) · repo entry: [`README.md`](README.md)

Gated LMS: verified watch → quiz with hearts → skill-tree unlock (staff) → mentor chat, events, weekly league, monthly XP challenges, certificates.

## Stack (short)

- **Backend:** Go (`backend/`) · Postgres · Redis · S3/RustFS · WS hub
- **Frontend:** Next.js App Router · React Query · Tailwind · Vazirmatn FD
- **Edge:** Traefik v3.7 — Compose and Helm/k3s

## Student path (short)

Login/CAPTCHA or register (public/invite) → `/cap` → `/player` → `/quiz` → staff unlock → certificate `/c/{publicId}` · profile `/profile` · hub `/unwrap`.

Public password recovery is disabled for students; resets are admin-only. Browser sessions use HttpOnly cookies.

## Docs

| Topic | File |
|-------|------|
| Architecture | [docs/architecture.md](docs/architecture.md) |
| Product | [docs/product.md](docs/product.md) |
| Development | [docs/development.md](docs/development.md) |
| Deployment | [docs/deployment.md](docs/deployment.md) |
| Security | [docs/security.md](docs/security.md) |
| Operations | [docs/operations.md](docs/operations.md) |
| API | [docs/api.md](docs/api.md) |
| Env | [docs/configuration.md](docs/configuration.md) |

Phone registration, unlisted certificates, chat-export, rate limits, and production notes live in those docs (not duplicated here to avoid drift).
