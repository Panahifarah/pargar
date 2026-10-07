-- 0001_init.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('student', 'mentor', 'admin');
CREATE TYPE notif_category AS ENUM ('progress', 'gamification', 'mentor', 'event');
CREATE TYPE quiz_status AS ENUM ('in_progress', 'passed', 'failed');
CREATE TYPE event_type AS ENUM ('meet', 'zoom', 'workshop');

CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    email               TEXT UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    name                TEXT NOT NULL,
    role                user_role NOT NULL DEFAULT 'student',
    xp                  INT NOT NULL DEFAULT 0,
    hearts              INT NOT NULL DEFAULT 3,
    hearts_updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    streak_current      INT NOT NULL DEFAULT 0,
    streak_longest      INT NOT NULL DEFAULT 0,
    last_activity_date  DATE,
    is_locked           BOOLEAN NOT NULL DEFAULT false,
    locked_at           TIMESTAMPTZ,
    unlocked_by         BIGINT REFERENCES users(id),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chapters (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon        TEXT NOT NULL DEFAULT 'leaf',
    sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE lessons (
    id                       BIGSERIAL PRIMARY KEY,
    chapter_id               BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    title                    TEXT NOT NULL,
    description              TEXT NOT NULL DEFAULT '',
    video_key                TEXT NOT NULL DEFAULT '',
    duration_seconds         INT NOT NULL DEFAULT 0,
    completion_threshold_pct INT NOT NULL DEFAULT 85,
    requires_lesson_id       BIGINT REFERENCES lessons(id),
    x                        INT NOT NULL DEFAULT 0,
    y                        INT NOT NULL DEFAULT 0,
    sort_order               INT NOT NULL DEFAULT 0,
    xp_reward                INT NOT NULL DEFAULT 50,
    is_active                BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE mcq_questions (
    id           BIGSERIAL PRIMARY KEY,
    lesson_id    BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    position     INT NOT NULL DEFAULT 0,
    question     TEXT NOT NULL,
    options      JSONB NOT NULL,
    answer_index INT NOT NULL,
    explanation  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE watch_sessions (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            BIGINT NOT NULL REFERENCES users(id),
    lesson_id          BIGINT NOT NULL REFERENCES lessons(id),
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_position      FLOAT NOT NULL DEFAULT 0,
    UNIQUE (user_id, lesson_id)
);

CREATE TABLE watch_heartbeats (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    lesson_id  BIGINT NOT NULL REFERENCES lessons(id),
    session_id BIGINT NOT NULL REFERENCES watch_sessions(id),
    position   FLOAT NOT NULL,
    delta      FLOAT NOT NULL,
    seq        INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, lesson_id, seq)
);

CREATE TABLE lesson_progress (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            BIGINT NOT NULL REFERENCES users(id),
    lesson_id          BIGINT NOT NULL REFERENCES lessons(id),
    watched_seconds    FLOAT NOT NULL DEFAULT 0,
    watched_pct        FLOAT NOT NULL DEFAULT 0,
    last_position      FLOAT NOT NULL DEFAULT 0,
    quiz_unlocked      BOOLEAN NOT NULL DEFAULT false,
    passed_quiz        BOOLEAN NOT NULL DEFAULT false,
    quiz_completed_at  TIMESTAMPTZ,
    UNIQUE (user_id, lesson_id)
);

CREATE TABLE quiz_attempts (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id),
    lesson_id     BIGINT NOT NULL REFERENCES lessons(id),
    answers       JSONB NOT NULL DEFAULT '[]',
    correct_count INT NOT NULL DEFAULT 0,
    total         INT NOT NULL DEFAULT 0,
    score_pct     FLOAT NOT NULL DEFAULT 0,
    status        quiz_status NOT NULL DEFAULT 'in_progress',
    hearts_lost   INT NOT NULL DEFAULT 0,
    passed_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE xp_events (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    amount     INT NOT NULL,
    source     TEXT NOT NULL,
    ref_id     BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE weekly_leaderboard (
    week    TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id),
    xp      INT NOT NULL DEFAULT 0,
    PRIMARY KEY (week, user_id)
);

CREATE TABLE events (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_type  event_type NOT NULL DEFAULT 'meet',
    external_url TEXT NOT NULL DEFAULT '',
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    ics_uuid    UUID NOT NULL DEFAULT gen_random_uuid(),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  BIGINT REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_rsvps (
    id         BIGSERIAL PRIMARY KEY,
    event_id   BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, user_id)
);

CREATE TABLE chat_messages (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    mentor_id   BIGINT NOT NULL REFERENCES users(id),
    sender_role user_role NOT NULL DEFAULT 'student',
    body        TEXT NOT NULL,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    category   notif_category NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    route      TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}',
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE notification_prefs (
    user_id      BIGINT PRIMARY KEY REFERENCES users(id),
    progress     BOOLEAN NOT NULL DEFAULT true,
    gamification BOOLEAN NOT NULL DEFAULT true,
    mentor       BOOLEAN NOT NULL DEFAULT true,
    event        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE video_assets (
    id         BIGSERIAL PRIMARY KEY,
    key        TEXT UNIQUE NOT NULL,
    mime       TEXT NOT NULL DEFAULT 'video/mp4',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reminders_sent (
    user_id BIGINT NOT NULL REFERENCES users(id),
    kind    TEXT NOT NULL,
    ref     TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, ref)
);