-- Human: Version history for file content writes — editors and public links no longer overwrite the only copy.
-- Agent: ADDS file_versions + files.revision; version blobs live at users/{uid}/revisions/{uuid}, never under a file prefix.

-- Human: Current revision number of the live bytes; prior revisions are rows in file_versions.
-- Agent: STARTS at 1 for every existing row; BUMPED by content_replace / restore.
ALTER TABLE files
    ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

-- Human: One row per superseded content state, holding the blob that used to be current.
-- Agent: storage_key is an IMMUTABLE blob — nothing ever PUTs over it again; purge is refcounted like dedup keys.
CREATE TABLE IF NOT EXISTS file_versions (
    id            TEXT PRIMARY KEY,
    file_id       TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    -- Human: Owner at archive time — quota is charged to them even if the edit came from a public link.
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision      INTEGER NOT NULL,
    storage_key   TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL,
    content_hash  TEXT,
    mime_type     TEXT,
    -- Human: NULL when an anonymous public-share editor produced the write it replaced.
    created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_via   TEXT NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT file_versions_revision_unique UNIQUE (file_id, revision),
    CONSTRAINT file_versions_created_via_check CHECK (
        created_via IN ('user', 'public_share', 'restore')
    )
);

-- Human: History panel reads newest-first for one file.
CREATE INDEX IF NOT EXISTS idx_file_versions_file_revision
    ON file_versions (file_id, revision DESC);

-- Human: Blob refcounting — a version key may also be a live files.storage_key (dedup sibling or restore target).
-- Agent: READ by storage_key_still_referenced before any purge.
CREATE INDEX IF NOT EXISTS idx_file_versions_storage_key
    ON file_versions (storage_key);

-- Human: Quota sums archived bytes per user alongside files.size_bytes.
CREATE INDEX IF NOT EXISTS idx_file_versions_user
    ON file_versions (user_id);

-- Human: Retention ceiling — versions kept per file before the oldest is pruned. 0 disables pruning.
-- Agent: READ via files::versions::max_versions_per_file; editable in admin System Settings.
INSERT INTO app_settings (key, value)
VALUES ('file_version_max_per_file', '25')
ON CONFLICT (key) DO NOTHING;
