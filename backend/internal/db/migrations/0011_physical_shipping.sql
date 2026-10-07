-- Shipping details + tracking for physical certificates

ALTER TABLE certificate_physical_orders
    ADD COLUMN IF NOT EXISTS recipient_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS tracking_code TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS unlock_requests (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS unlock_requests_user_created_idx
    ON unlock_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS unlock_requests_open_idx
    ON unlock_requests (created_at DESC)
    WHERE resolved_at IS NULL;
