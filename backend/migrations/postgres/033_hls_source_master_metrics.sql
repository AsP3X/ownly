-- Human: Retain original video masters for clean reprocess + record encode mode/timing for admin ops.
-- Agent: ADDS hls_source_master, hls_encode_mode, hls_last_encode_ms on files.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS hls_source_master BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS hls_encode_mode TEXT;

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS hls_last_encode_ms BIGINT;
