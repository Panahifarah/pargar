-- Own-message edits. Nullable so existing rows stay unedited.
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
