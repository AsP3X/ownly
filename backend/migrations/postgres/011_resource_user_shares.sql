-- Human: Grant specific instance users access to one owned file or folder.
-- Agent: owner_user_id owns the resource; grantee_user_id receives shared-with-me access later.

CREATE TABLE resource_user_shares (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK (resource_type IN ('file', 'folder')),
    resource_id TEXT NOT NULL,
    grantee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_user_id, resource_type, resource_id, grantee_user_id)
);

CREATE INDEX idx_resource_user_shares_resource
    ON resource_user_shares (owner_user_id, resource_type, resource_id);

CREATE INDEX idx_resource_user_shares_grantee
    ON resource_user_shares (grantee_user_id);
