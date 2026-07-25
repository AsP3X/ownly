-- Human: Track videos that already completed a user-triggered stream rebuild.
-- Agent: ADDS hls_stream_rebuilt so rebuild-all skips healthy already-repaired packages.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS hls_stream_rebuilt BOOLEAN NOT NULL DEFAULT false;
