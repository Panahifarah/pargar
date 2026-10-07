ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE users
SET username = lower(split_part(email, '@', 1))
WHERE username IS NULL OR username = '';

UPDATE users u
SET username = u.username || '-' || u.id::text
WHERE u.id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) AS rn
        FROM users
    ) ranked
    WHERE ranked.rn > 1
);

ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON users (lower(username));
