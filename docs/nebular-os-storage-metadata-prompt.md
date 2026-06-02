# Nebular OS implementation prompt — Postgres metadata mode and capacity enforcement

Use this document in the **nebular-os** repository (`AsP3X/nebular-os`). Ownly (this repo) already routes uploads using Postgres placement tables; Nebular changes below unlock **hard node quotas** and optional **blob-only** nodes when metadata lives in Ownly’s Postgres.

---

## Context (what Ownly does today)

Ownly stores **per-file placement** in Postgres:


| Table                                | Purpose                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `files.storage_node_id`              | Primary Nebular node for a file (and all HLS keys under `users/{uid}/files/{fid}/…`) |
| `file_storage_parts`                 | Stripe segments when one blob overflows a node’s `target_capacity_bytes`             |
| `storage_blob_placements`            | Temporary link from `storage_key` → node between PUT and `files` INSERT              |
| `app_settings.storage_metadata_mode` | `nebular` (default) or `ownly`                                                       |


Upload flow (Ownly API):

1. Probe each enabled row in `storage_nodes` via `GET {base_url}/metrics` → `logical_bytes`.
2. Compare to `target_capacity_bytes` (admin-configured cap).
3. If the object fits on one node → single `PUT` to that node’s `base_url`.
4. Else → split bytes across nodes in registration order; record parts in `file_storage_parts`.
5. Downloads/HLS use `files.storage_node_id` or stripe metadata to reach the correct `base_url`.

**Gap:** Nebular still accepts `PUT` even when over an operator-defined cap, so `logical_bytes` can exceed the admin target until Ownly’s planner runs. Optional **Nebular-side enforcement** makes caps trustworthy even for non-Ownly clients.

---

## Goal

Implement two related features in Nebular OS:

### A. Metadata backends (configuration)


| Mode                         | Env                                                                          | Behavior                                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Self-contained (default)** | `NOS_METADATA_BACKEND=sqlite` (or unset → current SQLite at `NOS_META_PATH`) | Today’s behavior: index + blobs on this node.                                                                                                                                                                 |
| **Postgres (blob-only)**     | `NOS_METADATA_BACKEND=postgres` + `NOS_METADATA_DATABASE_URL`                | **No** object index in SQLite for new writes; Postgres is authoritative. Nebular stores **only blob files** under `NOS_DATA_DIR` and uses Postgres for `bucket/key → blob path, size, etag, deleted_at`, etc. |


**Important:** In `postgres` mode, Ownly’s `files` / `file_storage_parts` tables remain the **application-level** placement index (which node, which stripe). Nebular Postgres tables are the **object-store** index (bucket/key/blob), not a duplicate of Ownly’s user file catalog.

### B. Per-node capacity limit (optional)

- Env: `NOS_MAX_LOGICAL_BYTES` (optional, 0 = unlimited).
- Before accepting a `PUT` / completing a multipart part, reject with **507 Insufficient Storage** (or your existing JSON error envelope) when `logical_bytes + incoming > NOS_MAX_LOGICAL_BYTES`.
- `GET /metrics` should expose both `logical_bytes` and `max_logical_bytes` (when set) so UIs can show “used / cap” without guessing.

---

## Configuration contract

Add to `.env.example` and document in README:

```bash
# Metadata backend: sqlite | postgres (default: sqlite)
NOS_METADATA_BACKEND=sqlite
NOS_META_PATH=/data/meta/metadata.db

# Required when NOS_METADATA_BACKEND=postgres
NOS_METADATA_DATABASE_URL=postgres://user:pass@host:5432/nebular_meta

# Optional hard cap for this node (bytes). 0 = no limit.
NOS_MAX_LOGICAL_BYTES=5368709120
```

**Docker Compose (Ownly `docker-compose.rep.yml` pattern):** second node sets the same env block but different `NOS_DATA_DIR`, `NOS_MAX_LOGICAL_BYTES`, and optionally `NOS_METADATA_DATABASE_URL` pointing at the **same** Postgres as Ownly when `storage_metadata_mode=ownly`.

---

## Postgres schema (Nebular object index)

Create migrations in nebular-os (sqlx or your migration tool). Suggested minimal schema:

```sql
CREATE TABLE nos_objects (
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    blob_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_type TEXT,
    etag TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (bucket, object_key)
);

CREATE INDEX idx_nos_objects_deleted ON nos_objects (deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE nos_multipart_uploads (
    upload_id TEXT PRIMARY KEY,
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    content_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE nos_multipart_parts (
    upload_id TEXT NOT NULL REFERENCES nos_multipart_uploads(upload_id) ON DELETE CASCADE,
    part_number INT NOT NULL,
    blob_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    etag TEXT,
    PRIMARY KEY (upload_id, part_number)
);
```

**Rules:**

- `PUT` / completed multipart: insert/upsert `nos_objects`, write blob under `NOS_DATA_DIR` using `blob_path` (content-addressed or `{bucket}/{key}` layout — keep consistent with existing engine).
- `DELETE`: soft-delete row + remove/blob per `NOS_SOFT_DELETE_DROP_BLOB`.
- `GET` / `HEAD` / `LIST`: read from Postgres, not SQLite, in `postgres` mode.
- `sqlite` mode: ignore `NOS_METADATA_DATABASE_URL`; keep current SQLite engine.

---

## HTTP / metrics changes

1. `**GET /metrics` (JSON)** — add fields:
  - `max_logical_bytes: i64` (0 = unlimited)
  - `metadata_backend: "sqlite" | "postgres"`
2. `**PUT /{bucket}/{key}`** — when `NOS_MAX_LOGICAL_BYTES > 0` and upload would exceed cap, return error JSON (same shape as existing Nebular errors) with HTTP **507**.
3. **Multipart** — enforce cap on **complete** (sum of parts), not only individual part size.
4. **Health** — include `metadata_backend` and whether Postgres ping succeeded when in postgres mode.

---

## Interaction with Ownly overflow

Ownly plans striping using **live** `logical_bytes` from each node’s `/metrics` and `storage_nodes.target_capacity_bytes`. Nebular enforcement should use the **same** `logical_bytes` definition so planner and server agree.

Recommended alignment:

- `logical_bytes` = sum of `size_bytes` for non-deleted objects in the active metadata backend for this node.
- When Ownly sets `NOS_MAX_LOGICAL_BYTES` equal to the admin “target capacity” for that node, Nebular rejects stray writes; Ownly’s planner still stripes before hitting the limit under normal use.

---

## Replication / cluster note

Ownly’s admin registry is **standalone multi-node** (see `014_storage_nodes_standalone.sql`), not Nebular cluster replication. Postgres metadata mode does **not** require cluster LIST merge. Each Nebular instance is an independent blob endpoint; Ownly’s `storage_nodes.base_url` selects the instance.

If cluster replication remains in nebular-os for other products, keep it **orthogonal**: `NOS_METADATA_BACKEND=postgres` should work on a single-node deployment first.

---

## Tests to add (nebular-os)

1. `sqlite` mode: existing tests unchanged.
2. `postgres` mode integration test with testcontainers Postgres:
  - PUT → row in `nos_objects` + blob on disk
  - GET returns bytes
  - DELETE removes/blob per policy
  - LIST prefix
3. `NOS_MAX_LOGICAL_BYTES`: PUT under cap succeeds; second PUT fails with 507.
4. Metrics JSON includes `max_logical_bytes` and `metadata_backend`.

---

## Rollout checklist for Ownly operators

1. Run Ownly migration `015_file_storage_placement.sql`.
2. Register nodes in Admin with **target capacity** and correct `base_url` per Nebular instance.
3. (Optional) Set `STORAGE_METADATA_MODE=ownly` in API env and `storage_metadata_mode` in app_settings via setup.
4. (Optional) Point each Nebular at Postgres with `NOS_METADATA_BACKEND=postgres` and set `NOS_MAX_LOGICAL_BYTES` to match admin cap.
5. Multi-node local test: `docker compose -f docker-compose.yml -f docker-compose.rep.yml up` and add node-b at `http://object-storage-b:9000`.

---

## Out of scope (nebular-os)

- Ownly user/file ACLs and `files` table — stay in Ownly API only.
- Cross-node read proxy (Ownly API streams or presigned URLs per node).
- Automatic rebalance of existing blobs when a node fills (future Ownly admin job).

---

## Acceptance criteria

- `NOS_METADATA_BACKEND` switches between SQLite and Postgres without breaking existing JSON error contracts.
- Postgres mode: no new SQLite writes for object index; blobs only on disk.
- `NOS_MAX_LOGICAL_BYTES` enforced on PUT/multipart complete with 507 when exceeded.
- `/metrics` exposes `logical_bytes`, `max_logical_bytes`, `metadata_backend`.
- Documented env vars in nebular-os `.env.example` and README.

