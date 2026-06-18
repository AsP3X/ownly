# Storage disk tuning (Ownly + Nebular OS)

Ownly sends **plaintext** file bytes to Nebular OS on normal drive uploads so zstd can compress them. Do **not** add whole-file blob encryption in the API before PUT — that defeats compression.

HLS is the exception: **AES-128-CBC** segment encryption runs in Ownly before segments are uploaded. Nebular still wraps ciphertext in indexed blocks when it helps, but encrypted `.m4s` payloads rarely shrink. Save disk on video with **encode settings** (CRF/CQ, max resolution) and retention, not zstd level alone.

## Nebular OS (object-storage service)

Configure on the **object-storage** container (see `docker-compose.yml` and `.env.example`).

| Variable | Default (Compose) | Purpose |
|----------|-------------------|---------|
| `NOS_ZSTD_LEVEL_UPLOAD` | `3` | Fast zstd on upload (NOSI writes) |
| `NOS_ZSTD_LEVEL` | `22` | Background recompress / maintenance zstd |
| `NOS_COMPRESS_MIN_SIZE` | `4096` | Skip compression below this logical size (bytes) |
| `NOS_COMPRESS_BLOCK_SIZE` | `1048576` | Uncompressed block size inside indexed blobs |
| `NOS_BLOCK_CACHE_ENTRIES` | `256` | Hot block decode cache for range GET |
| `NOS_RECOMPRESS_ON_STARTUP` | `false` | Background legacy→NOSI migration at boot (non-blocking HTTP) |
| `NOS_RECOMPRESS_INTERVAL_SECS` | `3600` | Periodic recompress; `0` disables |
| `NOS_VERIFY_INTERVAL_SECS` | `0` | Optional integrity scrub interval; `0` disables |
| `NOS_VERIFY_BATCH_SIZE` | `100` | Max objects per periodic scrub pass |
| `NOS_SCRUB_SAMPLE_DENOM` | `1024` | Hash-sample rate for periodic scrub (~1/N keys per pass) |
| `NOS_SCRUB_MODE` | `deep` | `light` (headers/sizes) or `deep` (checksums/decode) |
| `NOS_VERIFY_ON_READ` | `false` | When `true`, full raw-object GET verifies on-disk xxh3 against metadata etag |
| `NOS_READ_BUFFER_SIZE` | `262144` | Pooled read buffer for raw GET streaming |
| `NOS_WEBHOOKS_JSON` | *(empty)* | Per-bucket webhook URLs on PUT/DELETE, e.g. `{"media":["https://app/hooks/storage"]}` |
| `NOS_SOFT_DELETE_DROP_BLOB` | `true` | Drop blob files on soft-delete |
| `NOS_ZSTD_DICT_ENABLED` | `false` | Global zstd dictionary (optional) |
| `NOS_DEDUP_ENABLED` | `false` | Unified block dedup for large objects (optional) |
| `NOS_UPLOAD_MAX_IN_FLIGHT_BYTES` | `2147483648` (2 GiB) | Aggregate PUT body budget; below largest upload → instant 503 backpressure |
| `NOS_BULK_DELETE_*` | `32` / `1000` | Prefix and batch delete throughput |

**On-disk format (NOSI):** New writes use indexed block blobs (`NOSI`) with per-block checksums and optional dedup refs. Legacy `NOSB`, `NOSZ`, `NOS2`, and `NOSD` remain readable; background recompress migrates them to `NOSI` when smaller.

**Upload backpressure:** Nebular rejects PUTs when in-flight body bytes would exceed the cap (503 + `Retry-After`). Raise `NOS_UPLOAD_MAX_IN_FLIGHT_BYTES` for large drive uploads; pair with backend `STORAGE_PUT_MAX_CONCURRENT` (default 2).

**Integrity scrub:** `POST /_nos/maintenance/verify_blobs` (admin JWT) accepts `?mode=light|deep&sample_denom=&start_after=&limit=`. Periodic scrub uses `NOS_VERIFY_INTERVAL_SECS` with hash sampling (`NOS_SCRUB_SAMPLE_DENOM`) and a rotating key cursor. `NOS_VERIFY_ON_READ=true` checks raw blob etags on full-object GET without a separate scrub pass.

**Replication ops:** `POST /_nos/maintenance/replication_replay?event_id=<uuid>` (admin JWT) re-queues a dead-letter replication event. Chunked replicate payloads include a wire checksum verified on receive.

**Webhooks:** `NOS_WEBHOOKS_JSON` maps bucket names to URL lists; Nebular POSTs JSON on single-object PUT and DELETE (copy-object PUT and batch/prefix delete are not wired yet upstream).

**Node capacity:** Optional `NOS_MAX_LOGICAL_BYTES` on each Nebular instance should align with Ownly admin `target_capacity_bytes` for that storage node (HTTP 507 when full).

Align `NOS_MAX_BODY_SIZE` / `MAX_UPLOAD_BYTES` with nginx and the Ownly API upload cap.

## Ownly API (HLS ingest)

Configure on the **backend** container.

| Variable | Default | Purpose |
|----------|---------|---------|
| `HLS_VIDEO_CRF` | `20` | libx264 quality for GOP-aligned re-encode |
| `HLS_VIDEO_QUALITY` | `22` | NVENC CQ / VAAPI QP / QSV quality (align path) |
| `HLS_FULL_TRANSCODE_QUALITY` | `26` | Full transcode (all encoders; higher = smaller) |
| `HLS_LARGE_MAXRATE` | `5M` | Max bitrate cap when source &gt; 500 MiB |
| `HLS_LARGE_BUFSIZE` | `10M` | VBV buffer for large-source cap |
| `HLS_HARDWARE_ENCODE` | `auto` | `auto` \| `off` \| `nvenc` \| `vaapi` \| `qsv` |

Lower **CRF/CQ** values = higher quality and **larger** segments on disk.

## Audit: Postgres logical size vs on-disk blobs

From the repo root (Postgres reachable, Nebular data volume mounted or `NEBULAR_DATA_DIR` set):

(Use the shared `scripts/.venv` — run `bash scripts/setup-test-env.sh` once if you haven't.)

```bash
python scripts/storage-audit.py
```

The script loads `DATABASE_URL` and `NEBULAR_DATA_DIR` from the repo `.env` when those variables are not already exported (same discovery as the security-audit scripts: cwd, then parents up to `docker-compose.yml`). Shell exports take precedence.

Optional overrides:

```bash
export DATABASE_URL=postgres://ownly:ownly@localhost:5432/ownly
export NEBULAR_DATA_DIR=/var/lib/docker/volumes/ownly_nebular_data/_data/blobs
python scripts/storage-audit.py
```

Or point at a specific env file:

```bash
python scripts/storage-audit.py --env-file /path/to/.env
```

(Activate `scripts/.venv` first so `psycopg` is available. For host-side Postgres, use `localhost` in `DATABASE_URL`, not the Compose service name `postgres`.)

The script sums `files.size_bytes` (non-deleted) and walks the Nebular blob tree, classifying **NOSI**, legacy **NOSB/NOSZ/NOS2**, and **raw** files. Large gaps often mean orphaned blobs, incomplete deletes, or HLS sidecars not reflected in a single file row.

## Migrating legacy blobs (layout + compression)

Deployments that stored objects **before** flat encoded filenames (v0.1.4) or **NOSI** integration may still have:

- **Nested on-disk paths** for keys containing `/` (sidecars such as `…/grid-thumbnail.jpg` under a hash shard).
- **Legacy compression** (`NOSB`, `NOSZ`, `NOS2`, `NOSD`, or raw files).

### Automatic background upgrade (format only)

Recompression upgrades compression in place but does **not** relocate nested paths:

```bash
NOS_RECOMPRESS_ON_STARTUP=true
NOS_RECOMPRESS_INTERVAL_SECS=3600
```

### Admin migration API (layout + format)

Ownly exposes a batched admin endpoint that prefers Nebular `POST /_nos/maintenance/migrate_blobs`, and otherwise streams **GET → PUT** for keys that still contain `/`.

```bash
export OWNLY_API_URL=http://localhost:8080
export OWNLY_ADMIN_TOKEN='<admin JWT>'
bash scripts/migrate-storage-blobs.sh

# Dry-run without writes
MIGRATE_DRY_RUN=true bash scripts/migrate-storage-blobs.sh

# Continue from nodes[].next_start_after in the prior response
MIGRATE_START_AFTER='users/tenant/files/abc...' bash scripts/migrate-storage-blobs.sh
```

HTTP: `POST /api/v1/admin/maintenance/migrate-storage-blobs?limit=25&node_id=node-primary`

Audit action: `admin.storage_blobs.migrate`. Export local Nebular changes for upstream with `bash scripts/nebular-export-patch.sh`.

## What Ownly does not do (yet)

- **Per-user content dedup** — `content_hash` duplicate preflight only; each upload still gets its own `storage_key`. Planned: refcount + shared blob — [`storage-disk-improvements.md`](storage-disk-improvements.md) §2.
- **Lazy `export.mp4`** — thumbnail/zip paths may persist `{storage_key}/export.mp4` before the user downloads. Planned: on-demand export + TTL — [`storage-disk-improvements.md`](storage-disk-improvements.md) §1.
- **Automated orphan audit** — `storage-audit.py` is manual. Planned: scheduled run + alerts — [`storage-disk-improvements.md`](storage-disk-improvements.md) §3.
- **Nebular block dedup** — `NOS_DEDUP_ENABLED` is optional and separate from Ownly metadata dedup — [`storage-disk-improvements.md`](storage-disk-improvements.md) §6.
- **Per-size zstd tiers in Ownly** — Nebular uses upload vs maintenance levels only; there is no &lt;10 MiB → level 3 table in the engine.

Public pages under `/specs/storage` and `/specs/nebular-os` follow this document.
