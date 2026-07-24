-- Human: Upload reliability follow-ups — quota reservation, part checksums, client content_hash, metrics.
-- Agent: ADDITIVE columns on upload_sessions / upload_session_parts; daily rollup table for admin health.

ALTER TABLE upload_sessions
    ADD COLUMN IF NOT EXISTS content_hash TEXT,
    ADD COLUMN IF NOT EXISTS quota_owner_id TEXT,
    ADD COLUMN IF NOT EXISTS quota_reserved_bytes BIGINT NOT NULL DEFAULT 0;

-- Human: Backfill quota owner to session user for legacy rows (owner-owned uploads).
UPDATE upload_sessions
SET quota_owner_id = user_id
WHERE quota_owner_id IS NULL;

ALTER TABLE upload_session_parts
    ADD COLUMN IF NOT EXISTS content_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS signed_token TEXT;

CREATE TABLE IF NOT EXISTS upload_metrics_daily (
    day                DATE PRIMARY KEY,
    parts_direct       BIGINT NOT NULL DEFAULT 0,
    parts_proxy        BIGINT NOT NULL DEFAULT 0,
    parts_confirmed    BIGINT NOT NULL DEFAULT 0,
    sessions_created   BIGINT NOT NULL DEFAULT 0,
    sessions_completed BIGINT NOT NULL DEFAULT 0,
    sessions_aborted   BIGINT NOT NULL DEFAULT 0,
    sessions_expired   BIGINT NOT NULL DEFAULT 0,
    dedup_hits         BIGINT NOT NULL DEFAULT 0,
    quota_rejects      BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_quota_owner_active
    ON upload_sessions (quota_owner_id)
    WHERE status IN ('active', 'completing') AND quota_reserved_bytes > 0;
