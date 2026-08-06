-- Human: Indexes for upload session quota and admin aggregation queries.
-- Agent: load_user_reserved_bytes() filters status IN ('active','completing') AND quota_reserved_bytes > 0
--         per quota_owner_id; the admin upload-session list queries COUNT(*) by status. Neither path
--         had a matching index before this migration.

-- Human: Admin upload-session listing filters by status.
-- Agent: Partial index covers the two non-terminal statuses queried by the admin panel.
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status_active_completing
    ON upload_sessions (status)
    WHERE status IN ('active', 'completing');

-- Human: Per-user reserved-bytes sum for quota pre-flight checks.
-- Agent: INCLUDE (quota_reserved_bytes) makes the SUM an index-only scan;
--         partial WHERE matches the exact query predicate in load_user_reserved_bytes().
CREATE INDEX IF NOT EXISTS idx_upload_sessions_quota_owner_reserved
    ON upload_sessions (quota_owner_id) INCLUDE (quota_reserved_bytes)
    WHERE status IN ('active', 'completing') AND quota_reserved_bytes > 0;
