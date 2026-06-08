-- Human: Atomic permission grants — groups, grant rows, admin group seed and backfill.
-- Agent: ADDITIVE schema; backfills users.role=admin into group_members; seeds instance.admin on admin group.

CREATE TYPE grant_subject_type AS ENUM ('user', 'group');
CREATE TYPE grant_resource_type AS ENUM ('instance', 'folder', 'file');
CREATE TYPE grant_effect AS ENUM ('allow', 'deny');

CREATE TABLE groups (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE permission_grants (
    id            TEXT PRIMARY KEY,
    subject_type  grant_subject_type NOT NULL,
    subject_id    TEXT NOT NULL,
    resource_type grant_resource_type NOT NULL,
    resource_id   TEXT,
    permission    TEXT NOT NULL,
    effect        grant_effect NOT NULL DEFAULT 'allow',
    granted_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    CONSTRAINT permission_grants_resource_id_check CHECK (
        (resource_type = 'instance' AND resource_id IS NULL)
        OR (resource_type IN ('folder', 'file') AND resource_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_permission_grants_unique
    ON permission_grants (subject_type, subject_id, resource_type, resource_id, permission);

CREATE INDEX idx_permission_grants_resource
    ON permission_grants (resource_type, resource_id);

CREATE INDEX idx_permission_grants_subject
    ON permission_grants (subject_type, subject_id);

-- Human: System admin group — instance-wide control via instance.admin grant.
-- Agent: is_system=true prevents delete; slug=admin is stable for membership checks.
INSERT INTO groups (id, slug, name, description, is_system)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'admin',
    'Administrators',
    'Full instance administration',
    true
);

INSERT INTO permission_grants (
    id, subject_type, subject_id, resource_type, resource_id, permission, effect
)
VALUES (
    '00000000-0000-4000-8000-000000000002',
    'group',
    '00000000-0000-4000-8000-000000000001',
    'instance',
    NULL,
    'instance.admin',
    'allow'
);

-- Human: Existing admin users join the admin group (authorization source of truth going forward).
-- Agent: INSERT from users.role=admin; ON CONFLICT DO NOTHING for idempotent re-run safety.
INSERT INTO group_members (group_id, user_id)
SELECT '00000000-0000-4000-8000-000000000001', id
FROM users
WHERE role = 'admin'
ON CONFLICT DO NOTHING;
