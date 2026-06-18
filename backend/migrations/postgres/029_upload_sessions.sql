-- Human: Resumable chunked upload sessions — track parts on disk until complete registers a files row.
-- Agent: ADDITIVE schema; upload_session_parts PK (session_id, part_number); status enum via CHECK.

CREATE TABLE upload_sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id       TEXT NOT NULL,
    folder_id     TEXT REFERENCES folders(id) ON DELETE SET NULL,
    filename      TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    total_size    BIGINT NOT NULL,
    chunk_size    INTEGER NOT NULL,
    bytes_received BIGINT NOT NULL DEFAULT 0,
    storage_key   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT upload_sessions_status_check CHECK (
        status IN ('active', 'completing', 'complete', 'aborted')
    )
);

CREATE INDEX idx_upload_sessions_user ON upload_sessions(user_id);

CREATE INDEX idx_upload_sessions_expires_active
    ON upload_sessions(expires_at)
    WHERE status = 'active';

CREATE TABLE upload_session_parts (
    session_id   TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
    part_number  INTEGER NOT NULL,
    size_bytes   BIGINT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, part_number)
);
