# Security

## Authentication and sessions

| Mechanism | Details |
|-----------|---------|
| Login | username/email + password + image CAPTCHA |
| Access JWT | Short-lived (~15 minutes) |
| Refresh | Hashed in DB; remember-me ≈ 30 days, short session ≈ 24 hours |
| Browser cookies | `pargar_access` / `pargar_refresh` — `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https |
| Frontend storage | Only `user` in `localStorage` (`pargar.auth`); tokens are not persisted |
| API | `credentials: "include"`; optional Bearer for tests/clients |
| Logout | Revoke refresh + clear cookies |

Public password recovery (`/api/auth/recovery/*` and `/recovery`) is disabled for students (404). Resets are admin-only and require the target account’s security answer.

## Secrets

- Outside `DEV_MODE`, `Validate()` rejects values like `change-me` / `local-dev-only` and JWTs shorter than 32 characters.
- Local Helm: generate-once; production: `existingSecret` required.
- `ADMIN_PASSWORD` only bootstraps when the admin user is missing; restarts do not overwrite the password.

## Proxy and CORS

- Only peers in `TRUSTED_PROXY_CIDRS` are trusted for `X-Forwarded-*` / `X-Real-IP`.
- CORS: `FRONTEND_ORIGINS` + `PUBLIC_URL` with `AllowCredentials: true`.

## Registration IP binding

`REGISTRATION_ENFORCE_IP` (default **false**) optionally limits one successful public/invite registration per client IP. Leave it off when the app sits behind NAT or shared egress and cannot see real client addresses. Enable only after the edge forwards trustworthy `X-Forwarded-For` / `X-Real-IP` via `TRUSTED_PROXY_CIDRS`.

## Rate limiting

| Scope | Approximate behavior |
|-------|----------------------|
| Auth (login/register/captcha/refresh/recovery) | Redis per-IP budget; tighter after failures |
| Global `/api/*` | ~240 req/min/IP; 429 + user message + `Retry-After`; does not revoke tokens |
| External chat export | ~10/min/IP |
| Per-user uploads | Separately limited |

`/api/health` is excluded from the global ceiling. Note: per-IP rate limits still use the peer/forwarded address — configure trusted proxies when you need per-client fairness behind NAT.

## Uploads

| Type | Controls |
|------|----------|
| Admin video | Extension + MIME + magic (MP4/WebM) |
| Avatar | JPEG/PNG/WebP via magic only; client Content-Type is not trusted |
| Chat | Extension allow-list + sniff for image/video/audio/PDF/Office; raw public zip removed |

## Certificates and privacy

- Certificate URLs are unlisted; noindex via API, Traefik, Next, and robots.txt.
- Chat-export tokens are single-use, revocable, and redacted from logs/metric labels.

## Known trade-offs (current model)

- SameSite=Lax + same-origin instead of a separate CSRF token (adequate for this model; revisit if FE and API split domains).
- Donations and physical certificates have no online payment gateway — intentional.
- XSS remains dangerous; HttpOnly cookies reduce token theft from localStorage but do not eliminate XSS.
