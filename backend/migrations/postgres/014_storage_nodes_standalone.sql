-- Human: Standalone-only storage nodes — drop cluster replication schema if present.
-- Agent: Reverses optional storage_clusters migration; keeps architecture column default single.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'storage_nodes' AND column_name = 'architecture'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'storage_nodes' AND column_name = 'role'
    ) THEN
        ALTER TABLE storage_nodes ADD COLUMN architecture TEXT NOT NULL DEFAULT 'single';
        UPDATE storage_nodes SET architecture = 'single';
    END IF;
END $$;

ALTER TABLE storage_nodes ALTER COLUMN architecture SET DEFAULT 'single';

UPDATE storage_nodes
SET architecture = 'single'
WHERE architecture IS NULL OR architecture IN ('replicated', 'assigned');

DROP TABLE IF EXISTS storage_clusters;

ALTER TABLE storage_nodes DROP COLUMN IF EXISTS cluster_id;
ALTER TABLE storage_nodes DROP COLUMN IF EXISTS role;
ALTER TABLE storage_nodes DROP COLUMN IF EXISTS storage_classes;
ALTER TABLE storage_nodes DROP COLUMN IF EXISTS replication_group;

DELETE FROM app_settings WHERE key = 'storage_cluster_token';
