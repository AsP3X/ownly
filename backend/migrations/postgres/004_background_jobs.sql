-- Human: Persistent background job queue for uploads processing, downloads, and streaming prep.
-- Agent: WRITES background_jobs rows; WORKERS claim via FOR UPDATE SKIP LOCKED; UNIQUE active resource per kind.

CREATE TABLE background_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INT NOT NULL DEFAULT 0,
    error TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    resource_type TEXT,
    resource_id TEXT,
    label TEXT NOT NULL DEFAULT '',
    locked_by TEXT,
    locked_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_background_jobs_user_status ON background_jobs(user_id, status, created_at DESC);
CREATE INDEX idx_background_jobs_claim ON background_jobs(status, created_at ASC) WHERE status = 'queued';

-- Human: Only one active job per kind+resource (e.g. one HLS encode per file).
CREATE UNIQUE INDEX idx_background_jobs_active_resource
    ON background_jobs (kind, resource_type, resource_id)
    WHERE status IN ('queued', 'running') AND resource_id IS NOT NULL;
