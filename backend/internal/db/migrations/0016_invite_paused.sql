-- Allow temporarily pausing registration invites without revoking them

ALTER TABLE registration_invites
    DROP CONSTRAINT IF EXISTS registration_invites_status_check;

ALTER TABLE registration_invites
    ADD CONSTRAINT registration_invites_status_check
    CHECK (status IN ('active', 'paused', 'revoked', 'exhausted'));
