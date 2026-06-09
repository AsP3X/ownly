-- Human: Persistent admin storage blob migration runs — preview scan and migrate with full logs.
-- Agent: WRITES storage_migration_runs + log entries; READ by all InstanceAdmin sessions; RESUME on API startup.

CREATE TABLE storage_migration_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                TEXT NOT NULL CHECK (kind IN ('preview', 'migrate')),
    status              TEXT NOT NULL CHECK (status IN ('running', 'complete', 'error', 'cancelled')),
    node_id             TEXT,
    prefix              TEXT NOT NULL DEFAULT '',
    total_target        BIGINT NOT NULL DEFAULT 0,
    migrated            BIGINT NOT NULL DEFAULT 0,
    skipped             BIGINT NOT NULL DEFAULT 0,
    failed              BIGINT NOT NULL DEFAULT 0,
    scanned             BIGINT NOT NULL DEFAULT 0,
    current_node_id     TEXT,
    batch_number        INTEGER NOT NULL DEFAULT 0,
    preview_run_id      UUID REFERENCES storage_migration_runs (id) ON DELETE SET NULL,
    progress_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message       TEXT,
    started_by_user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    dismissed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_storage_migration_runs_running
    ON storage_migration_runs (created_at DESC)
    WHERE status = 'running';

CREATE INDEX idx_storage_migration_runs_undismissed
    ON storage_migration_runs (created_at DESC)
    WHERE dismissed_at IS NULL;

CREATE TABLE storage_migration_log_entries (
    id          BIGSERIAL PRIMARY KEY,
    run_id      UUID NOT NULL REFERENCES storage_migration_runs (id) ON DELETE CASCADE,
    level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
    message     TEXT NOT NULL,
    node_id     TEXT,
    object_key  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_storage_migration_log_run_id
    ON storage_migration_log_entries (run_id, id);
