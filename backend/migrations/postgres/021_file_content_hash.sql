-- Human: Store a SHA-256 digest of uploaded bytes for content-based duplicate detection.
-- Agent: NULL for legacy rows; indexed per user for active-library duplicate preflight queries.

ALTER TABLE files
    ADD COLUMN content_hash TEXT;

CREATE INDEX idx_files_user_content_hash
    ON files (user_id, content_hash)
    WHERE deleted_at IS NULL AND content_hash IS NOT NULL;
