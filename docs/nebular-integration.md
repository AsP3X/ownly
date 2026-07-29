# Nebular OS integration

← [Back to main README](../README.md) · [Documentation index](./README.md)

[Nebular OS](https://github.com/AsP3X/nebular-os) is Ownly’s object storage engine. In this monorepo it lives at `nebular-os/` as a **git submodule**.

## Vendor boundary

| Lives in Ownly | Lives in Nebular (upstream) |
|----------------|----------------------------|
| Compose wiring, env, public URL proxy | Blob store, zstd/NOSI, multipart, scrub |
| `files` metadata, quotas, placement | On-disk layout under `/data` |
| HLS encrypt + jobs | Serving GET/PUT of opaque objects |
| Upload sessions, dedup refcount | Optional block dedup (`NOS_DEDUP_*`) |

**Do not edit files under `nebular-os/` for Ownly features.** Storage engine changes belong in [AsP3X/nebular-os](https://github.com/AsP3X/nebular-os). Export local experimental diffs with:

```bash
./scripts/nebular-export-patch.sh
```

Git hooks (`./scripts/install-git-hooks.sh`) block accidental commits inside the submodule.

## Docker image

Compose builds the `object-storage` service from `nebular-os/` using [`docker/nebular-os.Dockerfile`](../docker/nebular-os.Dockerfile).

Data volume: `nebular_data` → container `/data` (`NOS_DATA_DIR=/data/blobs`, `NOS_META_PATH=/data/meta/metadata.db`).

## Bump the pinned commit

After an upstream release you want:

```bash
cd nebular-os && git fetch && git checkout <tag-or-sha>
cd .. && git add nebular-os
git commit -m "CHORE: Bump nebular-os to <tag-or-sha>"
```

Rebuild:

```bash
docker compose up --build object-storage
```

## Configuration

Nebular-facing env vars are documented in [Configuration](./configuration.md) and [Storage disk tuning](./storage-disk-tuning.md).  
Signing secrets used for presigned URLs must match between Ownly API and Nebular (`SIGNING_SECRET` / `NOS_SIGNING_SECRET`).

## Multi-node

Optional second instance: [Compose profiles](./compose-profiles.md) (`docker-compose.rep.yml`).  
Placement and capacity design: [Nebular metadata mode prompt](./nebular-os-storage-metadata-prompt.md).

## Backup

Always include Nebular `/data` (or the Compose volume) in disaster recovery: [Backup and restore](./backup-restore.md).

## Related

- Upstream README: `nebular-os/README.md` (after submodule init)
- [Architecture](./architecture.md)
- [Storage disk tuning](./storage-disk-tuning.md)
