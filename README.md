# Ownly

Self-hosted personal cloud storage for documents, images, videos, audio, and more — similar to OneDrive, Google Drive, or MEGA, but under your control.

**Documentation hub:** [`docs/README.md`](docs/README.md)

---

## Quick start

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and [Git](https://git-scm.com/downloads) with submodule support.

```bash
git clone --recurse-submodules <repository-url>
cd ownly
docker compose up --build
```

Open **http://localhost:8080**. Complete the first-run wizard (admin account, storage, database).

| Service | URL |
|---------|-----|
| Web UI | http://localhost:8080 |
| API | http://localhost:3000/api/v1 |
| Object storage (Nebular OS) | http://localhost:9000 |
| PostgreSQL | localhost:5432 |

Stop the stack (keeps data): `./scripts/compose-dev-down.sh`  
Do **not** use `docker compose down -v` unless you intend to wipe volumes.

Full walkthrough: **[Getting started](docs/getting-started.md)**

---

## Documentation

All setup, configuration, and operations guides live under **`docs/`**.

| Topic | Guide |
|-------|--------|
| **Getting started** (wizard, submodules, stop/start) | [docs/getting-started.md](docs/getting-started.md) |
| **Configuration** (env vars, secrets, URLs) | [docs/configuration.md](docs/configuration.md) |
| **Architecture** | [docs/architecture.md](docs/architecture.md) |
| **Local development** (Rust / Node, tests) | [docs/local-development.md](docs/local-development.md) |
| **Compose profiles** (prod, multi-node, GPU) | [docs/compose-profiles.md](docs/compose-profiles.md) |
| **Backup & restore** (Postgres + blobs) | [docs/backup-restore.md](docs/backup-restore.md) |
| **Secure deployment** | [docs/secure-deployment.md](docs/secure-deployment.md) |
| **Storage / disk tuning** | [docs/storage-disk-tuning.md](docs/storage-disk-tuning.md) |
| **Nebular OS integration** | [docs/nebular-integration.md](docs/nebular-integration.md) |
| **HTTP API (OpenAPI)** | [docs/api.md](docs/api.md) |
| **Improvement roadmap** | [docs/improvement-roadmap.md](docs/improvement-roadmap.md) |
| **Full index** | [docs/README.md](docs/README.md) |

### Common operations

```bash
# Full backup (database + object storage)
./scripts/backup-ownly.sh

# Restore (destructive — requires confirmation)
OWNLY_CONFIRM_RESTORE=yes ./scripts/restore-ownly.sh --from ./backups/ownly-YYYYMMDD-HHMMSS

# Production Compose overlay
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build

# Generate production .env secrets
./init-env.sh
```

Details: [Backup and restore](docs/backup-restore.md) · [Compose profiles](docs/compose-profiles.md) · [Configuration](docs/configuration.md)

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vite + React + TypeScript + Tailwind + shadcn/ui |
| Backend | Rust (Axum) |
| Database | PostgreSQL |
| Object storage | [Nebular OS](https://github.com/AsP3X/nebular-os) (submodule) |
| iOS | Native Swift client — [ios/README.md](ios/README.md) |

More context: [Architecture](docs/architecture.md)

---

## Project structure

```
.
├── backend/              # Rust Axum API + SQL migrations
├── frontend/             # Web application
├── nebular-os/           # Object storage (git submodule — read-only here)
├── ios/                  # Native iOS client
├── docker-compose*.yml   # Base stack + prod / GPU / multi-node overlays
├── scripts/              # Backup, restore, audit, Compose helpers
├── docs/                 # All documentation (start at docs/README.md)
├── CONTRIBUTING.md       # Branch flow and PR checks
└── security-audit.md     # Security findings and remediations
```

Nebular submodule rules: [Nebular integration](docs/nebular-integration.md)

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for branch flow (`feature/*` → `dev` → `master`), CI commands, and commit prefixes.

Local API/UI iteration: [Local development](docs/local-development.md)

---

## License

**Ownly is source-available, not OSI open source.** It is licensed under the
[Ownly Private Non-Commercial License (NOCL-1.0)](LICENSE).

- **Free without a commercial agreement:** private, non-commercial use by an individual,
  or private internal use by a qualifying non-profit — see Permitted Use in [LICENSE](LICENSE).
- **Commercial / for-profit use** requires a written Commercial License Agreement and fee —
  see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
- Bug and security reports: [Project Issue Tracker](https://github.com/AsP3X/ownly/issues/new)
  (do not exploit vulnerabilities).
