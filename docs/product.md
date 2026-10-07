# Product

## Roles

| Role | Access |
|------|--------|
| `student` | Learning path, mentor chat, events, league, challenges, profile, certificate |
| `mentor` | Same + curriculum/events/challenges content (staff) + student learning views |
| `admin` | All staff + users, site settings, invites, whitelist/blacklist, chat archive, physical orders |

## Student journey

1. **Login** `/login` — self-hosted image CAPTCHA + adaptive rate limits; “remember me” lengthens refresh lifetime.
2. **Public password recovery** — disabled for students. Password changes only from the admin panel (requires the account security answer).
3. **Registration**
   - Public `/register` when `registration_enabled` is on; phone must be on the one-time whitelist.
   - Invite `/register/invite/[token]` with capacity limits; works even if public registration is off.
4. **Skill tree** `/cap` — “next step”; progress and unlock requests.
5. **Player** `/player/[lessonId]` — verified watch.
6. **Quiz** `/quiz/[lessonId]` — wrong answers spend hearts; zero → `/lockout`.
7. **Hub** `/unwrap` — events, chat, league, support.
8. **Weekly league** `/leaderboard` — resets on Monday (ISO week); next reset shown in Jalali. Separate from monthly challenges.
9. **Monthly challenge** — XP goal in a time window; progress from quiz XP; cards on league/unwrap/profile.
10. **Profile** `/profile` — identity, stats, active challenge, certificate slot, avatar edit.
11. **Certificate** `/c/{publicId}` — unlisted link; physical copy only if admin enabled it and payment is **offline**.

## Registration and phone

- Whitelist and blacklist are **mutually exclusive**; import resolves conflicts.
- A phone already tied to an account cannot re-enter either list as a fresh entry.
- One account per phone and per IP on registration paths.
- Blacklist blocks all registration paths (public + invite) and keeps a failed-attempt history tab.

## Certificates

- `publicId` is a random 32-char hex (non-sequential).
- Anti-crawl: `X-Robots-Tag`, meta robots, `robots.txt` for `/c/` and `/api/certificates/`.
- Fixed slot on `/profile` (not inside the avatar dialog).
- Physical: price/window from site settings; chart default off; no online payment gateway.

## Admin panel (summary)

- Users, role, lock/unlock, password reset (requires target security answer)
- Chapters / lessons / questions / videos
- Events (Jalali date picker; real `isActive`)
- Monthly challenges (XP goal + window)
- Membership invites, whitelist/blacklist
- Site settings: public registration, donations, physical cert, landing sponsors
- Chat archives (ZIP export/restore + single-use external links)
- Physical certificate orders

## Support / donations

The community page is `chat` mode: no public payment card; coordination happens in private messages with the team.
