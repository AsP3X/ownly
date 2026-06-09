# Storage disk tuning (Ownly + Nebular OS)

Ownly sends **plaintext** file bytes to Nebular OS on normal drive uploads so zstd can compress them. Do **not** add whole-file blob encryption in the API before PUT — that defeats compression.

HLS is the exception: **AES-128-CBC** segment encryption runs in Ownly before segments are uploaded. Nebular still wraps ciphertext in block zstd when it helps, but encrypted `.m4s` payloads rarely shrink. Save disk on video with **encode settings** (CRF/CQ, max resolution) and retention, not zstd level alone.

## Nebular OS (object-storage service)

Configure on the **object-storage** container (see `docker-compose.yml` and `.env.example`).

| Variable | Default (Compose) | Purpose |
|----------|-------------------|---------|
| `NOS_ZSTD_LEVEL` | `3` | zstd level 1–22 for NOSB block writes (lower = faster uploads) |
| `NOS_COMPRESS_MIN_SIZE` | `4096` | Skip compression below this logical size (bytes) |
| `NOS_COMPRESS_BLOCK_SIZE` | `1048576` | Uncompressed block size inside NOSB blobs |
| `NOS_RECOMPRESS_ON_STARTUP` | `false` | Scan raw blobs at boot and rewrite as NOSB when smaller |
| `NOS_RECOMPRESS_INTERVAL_SECS` | `3600` | Periodic raw→NOSB pass; `0` disables |
| `NOS_SOFT_DELETE_DROP_BLOB` | `true` | Drop blob files on soft-delete |
| `NOS_RECONCILE_ON_STARTUP` | `false` | Metadata vs blob reconciliation at boot |
| `NOS_RECONCILE_INTERVAL_SECS` | `0` | Periodic reconciliation; `0` disables |

**On-disk format (NOSB):** Compressible objects use a block-compressed layout with per-block seek indexes. Incompressible MIME types and objects below `NOS_COMPRESS_MIN_SIZE` stay raw. If block compression does not shrink a payload, Nebular keeps the raw file.

**Migration from pre–block-compression Nebular:** Legacy `NOSZ` / `NOS2` whole-object blobs are **not readable** after this upgrade. Re-upload from source, or rely on periodic recompression only for **raw** blobs still on disk (already-compressed legacy blobs must be re-ingested).

**Upload concurrency:** Pair backend `STORAGE_PUT_MAX_CONCURRENT` (default 2) with host RAM and disk throughput. Nebular no longer exposes a separate in-flight byte cap env var — Ownly’s PUT gate limits parallel uploads.

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

The script sums `files.size_bytes` (non-deleted) and walks the Nebular blob tree, classifying **NOSB**, legacy **NOSZ/NOS2**, and **raw** files. Large gaps often mean orphaned blobs, incomplete deletes, or HLS sidecars not reflected in a single file row.

## What Ownly does not do (yet)

- **Content dedup** (“upload same file again”) — would need Ownly metadata + storage key strategy.
- **Separate upload vs maintenance zstd levels** — Nebular block-compression uses one `NOS_ZSTD_LEVEL`; tune recompress interval for background raw→NOSB passes.

Public pages under `/specs/storage` and `/specs/nebular-os` follow this document.
