-- Human: Indexes and a derived namespace column so the admin audit panel can filter without seq scans.
-- Agent: ADDS audit_logs.action_namespace (generated); INDEXES action/user_id/ip/resource + trigram search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Human: Category is the text before the first dot — disjoint by construction, correct for future actions.
-- Agent: GENERATED STORED so it is indexable; no trigger on the append-only ledger write path.
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS action_namespace TEXT
    GENERATED ALWAYS AS (split_part(action, '.', 1)) STORED;

CREATE INDEX IF NOT EXISTS idx_audit_logs_ns_created
    ON audit_logs (action_namespace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
    ON audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
    ON audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_created
    ON audit_logs (ip, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
    ON audit_logs (resource_type, resource_id);

-- Human: Trigram indexes back the free-text search box (ILIKE '%term%' on action and resource id).
-- Agent: GIN gin_trgm_ops — required for unanchored LIKE to use an index.
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_trgm
    ON audit_logs USING gin (action gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id_trgm
    ON audit_logs USING gin (resource_id gin_trgm_ops);

-- Human: Cursor pagination orders by (created_at DESC, id DESC) — stable when new events land mid-browse.
-- Agent: Composite index matches the keyset predicate exactly.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_id
    ON audit_logs (created_at DESC, id DESC);
