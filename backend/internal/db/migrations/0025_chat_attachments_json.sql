ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS attachments JSONB;
