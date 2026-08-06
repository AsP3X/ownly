-- Human: Trigram indexes so LOWER(name) LIKE '%term%' search uses a GIN index instead of a seq scan.
-- Agent: pg_trgm already enabled by 037_audit_log_filters.sql; IF NOT EXISTS is safe for idempotent re-runs.
--         The existing btree idx_files_user_name_lower (007) cannot serve leading-wildcard LIKE patterns.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Human: File name search — the hot path for the drive search box.
-- Agent: GIN gin_trgm_ops on lower(name); partial WHERE excludes soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_files_name_trgm
    ON files USING gin (lower(name) gin_trgm_ops)
    WHERE deleted_at IS NULL;

-- Human: Folder name search — same pattern, no existing name index at all.
-- Agent: Mirrors the files trigram index.
CREATE INDEX IF NOT EXISTS idx_folders_name_trgm
    ON folders USING gin (lower(name) gin_trgm_ops)
    WHERE deleted_at IS NULL;
