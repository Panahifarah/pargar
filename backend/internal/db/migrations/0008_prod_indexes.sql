-- Hot-path indexes and heartbeat retention helpers.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_lesson ON quiz_attempts (user_id, lesson_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_pair ON chat_messages (user_id, mentor_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_watch_heartbeats_created ON watch_heartbeats (created_at);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events (starts_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events (user_id, created_at DESC);
