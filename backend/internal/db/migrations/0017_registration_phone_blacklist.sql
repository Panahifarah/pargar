-- Phone blacklist: blocks all registration (public and invite)

CREATE TABLE IF NOT EXISTS registration_phone_blacklist (
    id         BIGSERIAL PRIMARY KEY,
    phone      TEXT NOT NULL UNIQUE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_phone_blacklist_created_at_idx
    ON registration_phone_blacklist (created_at DESC);
