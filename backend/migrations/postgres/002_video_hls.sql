-- Human: HLS playback metadata and per-file AES-128 keys for encrypted video segments.
-- Agent: APPLIED once at API startup; files rows gain encode status; file_encryption_keys CASCADE on file delete.

CREATE TABLE file_encryption_keys (
    file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    key_id TEXT NOT NULL UNIQUE,
    encrypted_key BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ
);

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS hls_ready BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hls_key_id TEXT,
    ADD COLUMN IF NOT EXISTS segment_count INTEGER,
    ADD COLUMN IF NOT EXISTS hls_encode_status TEXT,
    ADD COLUMN IF NOT EXISTS hls_encode_error TEXT,
    ADD COLUMN IF NOT EXISTS conversion_progress INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
