-- Chat export download links are single-use after a successful download.

ALTER TABLE chat_export_tokens
    ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS chat_export_tokens_used_idx
    ON chat_export_tokens (used_at)
    WHERE used_at IS NOT NULL;
