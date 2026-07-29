# Ownly backup and restore

**Audience:** operators of self-hosted Ownly (Docker Compose).  
**Goal:** full recovery of the **PostgreSQL** metadata database and **Nebular OS** object storage (file blobs + Nebular metadata).

---

## What to back up

| Component | Compose service | Data location | Contents |
|-----------|-----------------|---------------|----------|
| **Database** | `postgres` | volume `postgres_data` | Users, folders, files metadata, shares, jobs, upload sessions, settings |
| **Object storage** | `object-storage` | volume `nebular_data` → `/data` | Blob store under `/data/blobs` + Nebular SQLite under `/data/meta` |
| **Optional node B** | `object-storage-b` | volume `nebular_extra_b_data` | Second Nebular node if `docker-compose.rep.yml` is used |
| **Secrets** | host files | `.env`, `backend/.env` | JWT/signing passwords — **not** in Compose volumes by default |

In-flight video **spools** under the API container `/tmp` are **not** part of a durable backup. Finish or cancel open uploads before a planned restore.

Managed PostgreSQL (RDS, Cloud SQL, etc.) should use the provider’s snapshot tooling for the DB; still back up Nebular volumes the same way.

---

## Quick start (Compose)

With the stack running from the repo root:

```bash
# Full backup → ./backups/ownly-YYYYMMDD-HHMMSS/
./scripts/backup-ownly.sh

# Custom location + copy .env secrets into the archive (handle carefully)
./scripts/backup-ownly.sh -o /mnt/backups/ownly-weekly --include-secrets

# Production compose overlay
./scripts/backup-ownly.sh -f docker-compose.yml -f docker-compose.prod.yml
```

Each backup directory contains:

| File | Purpose |
|------|---------|
| `MANIFEST.json` | Format version, sizes, git SHA, component list |
| `SHA256SUMS` | Checksums for integrity |
| `postgres.dump` | `pg_dump -Fc` custom format |
| `nebular-data.tar.gz` | Full Nebular `/data` tree (blobs + meta) |
| `nebular-extra-b-data.tar.gz` | Present only if node-b was running |
| `secrets/` | Only with `--include-secrets` |

### Restore (destructive)

```bash
# Overwrites the current database and blob volumes
OWNLY_CONFIRM_RESTORE=yes ./scripts/restore-ownly.sh --from ./backups/ownly-YYYYMMDD-HHMMSS
```

Restore stops `backend`/`frontend`, replaces Postgres and Nebular data, then brings services back up. Backend startup re-applies any **newer** SQL migrations if you upgraded the image since the backup.

---

## Partial backups

```bash
./scripts/backup-ownly.sh --db-only
./scripts/backup-ownly.sh --blobs-only

OWNLY_CONFIRM_RESTORE=yes ./scripts/restore-ownly.sh --from DIR --db-only
OWNLY_CONFIRM_RESTORE=yes ./scripts/restore-ownly.sh --from DIR --blobs-only
```

A **blobs-only** restore without a matching database snapshot will leave metadata out of sync (orphaned or missing keys). Prefer full backups for disaster recovery.

---

## Offline / non-Compose hosts

| Situation | Approach |
|-----------|----------|
| Postgres container down | Set `DATABASE_URL=postgres://…` and install client `pg_dump` |
| Nebular container down | Set `NEBULAR_DATA_DIR` to the host path of the volume’s `/data` (or mount it) |
| Volume path on Linux Docker | Often `/var/lib/docker/volumes/<project>_nebular_data/_data` |

```bash
export DATABASE_URL='postgres://ownly:SECRET@127.0.0.1:5432/ownly'
export NEBULAR_DATA_DIR=/var/lib/docker/volumes/ownly_nebular_data/_data
./scripts/backup-ownly.sh -o /mnt/backups/ownly-manual
```

---

## Recommended schedule and retention

| Environment | RPO guidance | Retention idea |
|-------------|--------------|----------------|
| Home / small lab | Daily full backup | Keep 7 dailies + 4 weeklies |
| Small production | Daily full + Postgres PITR if managed DB | Off-site copy of the latest full set |
| Large libraries | Nightly full; consider restic/borg on the backup directory | Encrypt off-site copies |

Copy backup directories **off the same disk** as the live volumes. Treat archives that include `--include-secrets` as credentials.

Honest expectations for this script set:

- **RPO:** time since last successful backup (no continuous WAL shipping in the scripts).
- **RTO:** tens of minutes for small instances; dominated by blob `tar` size and disk speed.

---

## Verification after restore

1. `docker compose ps` — postgres, object-storage, backend healthy.
2. Sign in to the web UI.
3. Open a known folder; download a file that existed before the backup.
4. Optional: play a video (HLS) to confirm segment objects restored.
5. Optional: run `scripts/storage-audit.py` (see [`storage-disk-tuning.md`](storage-disk-tuning.md)) to compare logical vs on-disk bytes.

---

## Manual commands (reference)

If you prefer not to use the scripts:

```bash
# Database
docker compose exec -T postgres \
  pg_dump -U ownly -d ownly -Fc --no-owner --no-acl > postgres.dump

# Nebular /data
CTR=$(docker compose ps -q object-storage)
docker exec "$CTR" tar czf - -C /data . > nebular-data.tar.gz
```

Restore sketch:

```bash
docker compose stop backend frontend object-storage
docker compose exec -T postgres dropdb -U ownly --if-exists ownly
docker compose exec -T postgres createdb -U ownly ownly
docker compose exec -T postgres pg_restore -U ownly -d ownly --no-owner --no-acl < postgres.dump
# Extract nebular-data.tar.gz into the object-storage volume (see restore-ownly.sh)
docker compose up -d
```

---

## Security notes

- Backups contain **all file contents** (encrypted-at-rest layout is Nebular’s on-disk format; treat as sensitive).
- Postgres dumps include password hashes, share secrets, and app settings.
- Prefer encrypting off-site copies (`age`, `gpg`, restic with password).
- Do not commit backup directories to git (keep them under `backups/` or outside the repo).

---

## Related

- [`secure-deployment.md`](secure-deployment.md) — production Compose, secrets, CORS  
- [`storage-disk-tuning.md`](storage-disk-tuning.md) — disk layout and audit tooling  
- [`improvement-roadmap.md`](improvement-roadmap.md) §4.4 — original backup tooling proposal  
