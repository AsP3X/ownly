-- Human: Index running jobs by last activity for stale-lock sweeper queries.
-- Agent: READ by recover_stale_jobs WHERE status=running AND updated_at older than threshold.

CREATE INDEX idx_background_jobs_stale_running
    ON background_jobs (updated_at ASC)
    WHERE status = 'running';
