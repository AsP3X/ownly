-- Human: Public share links — unguessable tokens scoped to one file or folder.
-- Agent: ONE active row per (user_id, resource_type, resource_id); revoked_at disables access.

CREATE TABLE public_shares (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK (resource_type IN ('file', 'folder')),
    resource_id TEXT NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, resource_type, resource_id)
);

CREATE INDEX idx_public_shares_token_active ON public_shares (token) WHERE revoked_at IS NULL;
