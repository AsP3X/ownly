-- Human: Cached MP4 export for HLS-stored videos — rebuilt on download request.
-- Agent: APPLIED at startup; tracks export job progress separate from upload encode fields.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS download_export_ready BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS download_export_status TEXT,
    ADD COLUMN IF NOT EXISTS download_export_progress INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS download_export_error TEXT,
    ADD COLUMN IF NOT EXISTS download_export_size_bytes BIGINT;
