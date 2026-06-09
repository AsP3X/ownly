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
| `NOS_SOFT_DELETE_DROP_BLOB` | `true` | Drop blob files on soft-delete |
| `NOS_ZSTD_DICT_ENABLED` | `false` | Global zstd dictionary (optional) |
| `NOS_DEDUP_ENABLED` | `false` | Unified block dedup for large objects (optional) |
| `NOS_UPLOAD_MAX_IN_FLIGHT_BYTES` | `2147483648` (2 GiB) | Aggregate PUT body budget; below largest upload → instant 503 backpressure |
| `NOS_BULK_DELETE_*` | `32` / `1000` | Prefix and batch delete throughput |

**On-disk format (NOSI):** New writes use indexed block blobs (`NOSI`) with per-block checksums and optional dedup refs. Legacy `NOSB`, `NOSZ`, `NOS2`, and `NOSD` remain readable; background recompress migrates them to `NOSI` when smaller.

**Upload backpressure:** Nebular rejects PUTs when in-flight body bytes would exceed the cap (503 + `Retry-After`). Raise `NOS_UPLOAD_MAX_IN_FLIGHT_BYTES` for large drive uploads; pair with backend `STORAGE_PUT_MAX_CONCURRENT` (default 2).

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

## What Ownly does not do (yet)

- **Content dedup** (“upload same file again”) — would need Ownly metadata + storage key strategy; Nebular block dedup is optional and separate.
- **Per-size zstd tiers in Ownly** — Nebular uses upload vs maintenance levels only; there is no &lt;10 MiB → level 3 table in the engine.

Public pages under `/specs/storage` and `/specs/nebular-os` follow this document.
