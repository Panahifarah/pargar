CREATE TABLE IF NOT EXISTS chat_reactions (
  id         BIGSERIAL PRIMARY KEY,
  message_id BIGINT  NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);
