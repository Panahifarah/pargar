ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_messages_pinned
    ON chat_messages (user_id, mentor_id, pinned_at DESC)
    WHERE pinned_at IS NOT NULL;
