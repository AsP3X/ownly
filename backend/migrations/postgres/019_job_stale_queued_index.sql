-- Human: Index queued jobs by enqueue time for prolonged-queue restart sweeper queries.
-- Agent: READ by recover_stale_queued_jobs WHERE status=queued AND created_at older than threshold.

CREATE INDEX idx_background_jobs_stale_queued
    ON background_jobs (created_at ASC)
    WHERE status = 'queued';
