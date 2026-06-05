-- Human: Video thumbnail sidecar metadata — multiple scored poster frames stored in Nebular OS.
-- Agent: WRITES video_thumbnail_* columns; background worker sets manifest key + selected_index.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS video_thumbnail_ready BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS video_thumbnail_status TEXT,
    ADD COLUMN IF NOT EXISTS video_thumbnail_error TEXT,
    ADD COLUMN IF NOT EXISTS video_thumbnail_manifest_key TEXT,
    ADD COLUMN IF NOT EXISTS video_thumbnail_selected_index INTEGER NOT NULL DEFAULT 0;
