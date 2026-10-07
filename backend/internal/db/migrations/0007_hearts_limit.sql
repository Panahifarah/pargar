-- Keep the database invariant aligned with the application-level hearts guard.
UPDATE users
SET hearts = 3,
    is_locked = true,
    locked_at = COALESCE(locked_at, now()),
    hearts_updated_at = now()
WHERE hearts > 3;

ALTER TABLE users
    ADD CONSTRAINT users_hearts_max CHECK (hearts BETWEEN 0 AND 3);
