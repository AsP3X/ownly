-- Human: Optional protection settings for public share links.
-- Agent: password_hash NULL = open link; expires_at past = inactive; block_download restricts download route.

ALTER TABLE public_shares
    ADD COLUMN password_hash TEXT,
    ADD COLUMN expires_at TIMESTAMPTZ,
    ADD COLUMN block_download BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_public_shares_expires_at ON public_shares (expires_at)
    WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
