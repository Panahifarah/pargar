-- Time-limited, revocable download tokens for project-wide chat export links.

CREATE TABLE IF NOT EXISTS chat_export_tokens (
    id           BIGSERIAL PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    token_enc    TEXT NOT NULL,
    label        TEXT NOT NULL DEFAULT '',
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS chat_export_tokens_active_idx
    ON chat_export_tokens (expires_at DESC)
    WHERE revoked_at IS NULL;
