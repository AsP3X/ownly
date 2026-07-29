-- Human: Allow multiple files rows to share one storage_key for per-user content-hash dedup.
-- Agent: DROP UNIQUE on files.storage_key; KEEP non-unique index for refcount/delete lookups.
-- Agent: SAFE for existing libraries — every row already has a distinct storage_key; only enables sharing going forward.

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_storage_key_key;

CREATE INDEX IF NOT EXISTS idx_files_storage_key ON files (storage_key);
