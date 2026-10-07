-- Audit log when a blacklisted phone tries to register (public or invite).

CREATE TABLE IF NOT EXISTS registration_blacklist_attempts (
    id                 BIGSERIAL PRIMARY KEY,
    phone              TEXT NOT NULL,
    path               TEXT NOT NULL CHECK (path IN ('public', 'invite')),
    invite_id          BIGINT REFERENCES registration_invites(id) ON DELETE SET NULL,
    ip                 TEXT NOT NULL DEFAULT '',
    user_agent         TEXT NOT NULL DEFAULT '',
    attempted_username TEXT NOT NULL DEFAULT '',
    attempted_email    TEXT NOT NULL DEFAULT '',
    attempted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_blacklist_attempts_phone_idx
    ON registration_blacklist_attempts (phone);

CREATE INDEX IF NOT EXISTS registration_blacklist_attempts_attempted_at_idx
    ON registration_blacklist_attempts (attempted_at DESC);
