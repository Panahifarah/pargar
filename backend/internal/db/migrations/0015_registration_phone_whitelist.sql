-- One-shot phone whitelist for public registration

CREATE TABLE IF NOT EXISTS registration_phone_whitelist (
    id               BIGSERIAL PRIMARY KEY,
    phone            TEXT NOT NULL UNIQUE,
    status           TEXT NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available', 'consumed')),
    consumed_at      TIMESTAMPTZ,
    consumed_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT registration_phone_whitelist_consumed_consistency CHECK (
        (status = 'available' AND consumed_at IS NULL AND consumed_user_id IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS registration_phone_whitelist_status_idx
    ON registration_phone_whitelist (status, created_at DESC);
