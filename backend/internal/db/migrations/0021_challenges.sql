CREATE TABLE IF NOT EXISTS challenges (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_xp   INT NOT NULL CHECK (target_xp > 0),
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_challenges_active_window
    ON challenges (is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS challenge_progress (
    challenge_id BIGINT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    xp           INT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_progress_user ON challenge_progress (user_id);
