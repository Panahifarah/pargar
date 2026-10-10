<p align="center">
  <img src="frontend/public/logo.png" alt="Pargar mark" width="96" />
</p>

<h1 align="center">Pargar</h1>

<p align="center">
  <strong>A bootcamp learning path with no shortcuts.</strong><br />
  Verified watch, quizzes with hearts, a skill tree, and a mentor. The product UI is Persian (پرگار).
</p>

<p align="center">
  <a href="https://github.com/Panahifarah/pargar/releases/tag/v0.2.0"><img src="https://img.shields.io/github/v/tag/Panahifarah/pargar?label=release&color=5B4CDB" alt="release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-5B4CDB" alt="AGPL-3.0" /></a>
</p>

Pargar is a gated LMS for a bootcamp. A student watches the lesson for real, passes that lesson's quiz, and only then opens the next branch of the skill tree. Alongside the path: mentor chat, events, a weekly league, a monthly challenge, and a certificate.

Public registration sits behind a phone whitelist. Invite links work on their own. Students cannot recover a password themselves; an admin sets a new one from that person's profile.

## The path

| Step | What happens |
| --- | --- |
| Verified watch | Watch time is checked with periodic heartbeats. Skipping ahead does not finish the lesson. |
| Quiz with hearts | Each wrong answer spends a heart. An empty heart meter locks the account until staff reviews it. |
| Skill tree | The next branch opens only after its parent is passed. Staff unlock the following lesson. |
| Community | Mentor chat, events, a weekly league that resets on Monday, and a monthly challenge. |
| Certificate | An unlisted digital link. A physical copy, when enabled, is offline payment only. |

Three roles: a **student** walks the path, a **mentor** sees curriculum and student learning, and an **admin** also manages users, invites, site settings, and physical certificate orders.

Product detail: [docs/product.md](docs/product.md)

## Run it locally

Docker is required. Copy `.env.example` and replace every `replace-with-…` value. The admin password is `ADMIN_PASSWORD`. The default username is `admin`.

```bash
cp .env.example .env
./scripts/compose-dev.sh up -d --build
```

The app is at [https://localhost](https://localhost). Traefik uses its own certificate, so the browser shows one warning. API health:

```bash
curl -k https://localhost/api/health
```

k3s and production: [docs/deployment.md](docs/deployment.md)

## Stack

| Layer | Technology |
| --- | --- |
| API | Go, Postgres, Redis, S3/RustFS, WebSocket |
| UI | Next.js 15, React, Tailwind |
| Edge | Traefik, on Compose and Helm |

The browser talks to one origin. Traefik splits the UI from `/api`. Detail: [docs/architecture.md](docs/architecture.md)

## Repository

```text
backend/     API, migrations, seed data
frontend/    Next.js UI
deploy/      Compose, Traefik, Helm chart
scripts/     Local run, k3s, backup
docs/        Engineering docs
```

| Doc | Read it for |
| --- | --- |
| [Product](docs/product.md) | Student path, admin, invites, certificates |
| [Architecture](docs/architecture.md) | Data flow and service boundaries |
| [Development](docs/development.md) | Local workflow and tests |
| [Deployment](docs/deployment.md) | Compose, Helm, production |
| [Security](docs/security.md) | Sessions, secrets, rate limits, uploads |
| [Operations](docs/operations.md) | Backup, metrics, troubleshooting |
| [API](docs/api.md) | Route contract |
| [Configuration](docs/configuration.md) | Environment variables |

Index: [docs/README.md](docs/README.md)

## License

Released under [AGPL-3.0](LICENSE).
