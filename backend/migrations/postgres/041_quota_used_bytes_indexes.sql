-- Human: Covering indexes so quota SUM(size_bytes) scans are index-only — no heap fetches.
-- Agent: load_user_used_bytes() SUMs files + file_versions per user_id on every upload finalize;
--         these INCLUDE indexes let both sub-selects run as index-only scans.

-- Human: Active files owned by one user — the dominant term in used-bytes calculation.
-- Agent: Partial index excludes soft-deleted rows; INCLUDE (size_bytes) avoids heap lookups.
CREATE INDEX IF NOT EXISTS idx_files_user_size_active
    ON files (user_id) INCLUDE (size_bytes)
    WHERE deleted_at IS NULL;

-- Human: Archived version bytes charged to the same owner.
-- Agent: Mirrors the files index; version rows are never soft-deleted so no partial WHERE needed.
CREATE INDEX IF NOT EXISTS idx_file_versions_user_size
    ON file_versions (user_id) INCLUDE (size_bytes);
