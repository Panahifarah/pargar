ALTER TYPE notif_category ADD VALUE IF NOT EXISTS 'urgent';
ALTER TYPE notif_category ADD VALUE IF NOT EXISTS 'curriculum';
ALTER TYPE notif_category ADD VALUE IF NOT EXISTS 'community';
ALTER TYPE notif_category ADD VALUE IF NOT EXISTS 'system';

CREATE TABLE IF NOT EXISTS announcements (
    id         BIGSERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'event',
    route      TEXT NOT NULL DEFAULT '',
    pinned     BOOLEAN NOT NULL DEFAULT false,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS announcement_id BIGINT REFERENCES announcements(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS chat_prefs (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_rank INT,
    muted       BOOLEAN NOT NULL DEFAULT false,
    archived    BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, partner_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted_all BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS saved_messages (
    id               BIGSERIAL PRIMARY KEY,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body             TEXT NOT NULL DEFAULT '',
    attachment_url   TEXT NOT NULL DEFAULT '',
    attachment_type  TEXT NOT NULL DEFAULT '',
    attachment_name  TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    banner_photo    TEXT NOT NULL DEFAULT '',
    profile_public  BOOLEAN NOT NULL DEFAULT false,
    show_activity   BOOLEAN NOT NULL DEFAULT true,
    show_stats      BOOLEAN NOT NULL DEFAULT true,
    show_path       BOOLEAN NOT NULL DEFAULT true,
    show_badges     BOOLEAN NOT NULL DEFAULT true,
    social_links    JSONB NOT NULL DEFAULT '[]',
    theme           TEXT NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS bot_tokens (
    id          BIGSERIAL PRIMARY KEY,
    bot_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id    BIGINT NOT NULL REFERENCES users(id),
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_updates (
    id          BIGSERIAL PRIMARY KEY,
    bot_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS buttons JSONB NOT NULL DEFAULT '[]';
ALTER TABLE users ALTER COLUMN hearts SET DEFAULT 5;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hearts_max;
ALTER TABLE users ADD CONSTRAINT users_hearts_max CHECK (hearts BETWEEN 0 AND 5);
