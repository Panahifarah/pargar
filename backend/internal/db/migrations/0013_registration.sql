-- Gated public registration: IP one-shot + admin toggle

CREATE TABLE IF NOT EXISTS registration_ips (
    ip         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_ips_user_idx ON registration_ips (user_id);

INSERT INTO app_settings (key, value) VALUES
    ('registration_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
