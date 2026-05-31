-- Human: Admin-configured Nebular OS storage nodes for the Storage Nodes Network panel.
-- Agent: Rows inserted via POST /admin/storage/nodes and setup bootstrap; probed at list time.

CREATE TABLE storage_nodes (
    id TEXT PRIMARY KEY,
    region_label TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL UNIQUE,
    architecture TEXT NOT NULL DEFAULT 'replicated',
    target_capacity_bytes BIGINT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_storage_nodes_enabled ON storage_nodes (enabled);

-- Human: Backfill primary node for instances that completed setup before this migration.
INSERT INTO storage_nodes (id, region_label, base_url, architecture)
SELECT
    'node-primary',
    COALESCE((SELECT value FROM app_settings WHERE key = 'instance_name'), 'Primary'),
    (SELECT value FROM app_settings WHERE key = 'object_storage_url'),
    'single'
WHERE EXISTS (SELECT 1 FROM users LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM storage_nodes LIMIT 1)
  AND EXISTS (SELECT 1 FROM app_settings WHERE key = 'object_storage_url');
