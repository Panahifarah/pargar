-- Capacity-limited registration invite / membership links

CREATE TABLE IF NOT EXISTS registration_invites (
    id          BIGSERIAL PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    token_enc   TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    max_uses    INT NOT NULL CHECK (max_uses > 0),
    used_count  INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'revoked', 'exhausted')),
    expires_at  TIMESTAMPTZ,
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT registration_invites_used_lte_max CHECK (used_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS registration_invites_status_idx
    ON registration_invites (status, created_at DESC);
