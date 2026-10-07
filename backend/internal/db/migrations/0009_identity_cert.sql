-- Identity, Telegram, security Q/A, certificates, physical orders

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer_hash TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx
    ON users (phone) WHERE phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_uidx
    ON users (telegram_id) WHERE telegram_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS certificates (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_id   TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ,
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS certificates_public_id_idx ON certificates (public_id);

CREATE TYPE physical_order_status AS ENUM ('requested', 'paid', 'shipped', 'cancelled');

CREATE TABLE IF NOT EXISTS certificate_physical_orders (
    id              BIGSERIAL PRIMARY KEY,
    certificate_id  BIGINT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          physical_order_status NOT NULL DEFAULT 'requested',
    note            TEXT NOT NULL DEFAULT '',
    window_ends_at  TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cert_physical_orders_user_idx
    ON certificate_physical_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cert_physical_orders_status_idx
    ON certificate_physical_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

INSERT INTO app_settings (key, value) VALUES
    ('physical_cert_enabled', 'true'),
    ('physical_cert_price_irr', '2500000'),
    ('physical_cert_window_days', '30')
ON CONFLICT (key) DO NOTHING;
