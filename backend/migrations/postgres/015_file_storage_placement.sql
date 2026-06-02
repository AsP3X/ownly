-- Human: Ownly-side blob placement for multi-node capacity routing and optional Postgres metadata mode.
-- Agent: files.storage_node_id + file_storage_parts; app_settings storage_metadata_mode default nebular.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS storage_node_id TEXT REFERENCES storage_nodes (id);

CREATE INDEX IF NOT EXISTS idx_files_storage_node_id ON files (storage_node_id);

-- Human: Stripe metadata when one logical file spans multiple Nebular nodes (overflow past node cap).
-- Agent: KEYED by base storage_key (users/{user}/files/{file_id}); READ by RouterStorage on GET.
CREATE TABLE IF NOT EXISTS file_storage_parts (
    storage_key TEXT NOT NULL,
    part_index INT NOT NULL,
    storage_node_id TEXT NOT NULL REFERENCES storage_nodes (id),
    object_key TEXT NOT NULL,
    byte_offset BIGINT NOT NULL,
    byte_length BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (storage_key, part_index)
);

CREATE INDEX IF NOT EXISTS idx_file_storage_parts_node ON file_storage_parts (storage_node_id);

-- Human: Written on PUT before the files row exists; linked after INSERT during upload.
-- Agent: storage_blob_placements.storage_key matches files.storage_key; WRITES storage_node_id on link.
CREATE TABLE IF NOT EXISTS storage_blob_placements (
    storage_key TEXT PRIMARY KEY,
    storage_node_id TEXT NOT NULL REFERENCES storage_nodes (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value)
VALUES ('storage_metadata_mode', 'nebular')
ON CONFLICT (key) DO NOTHING;
