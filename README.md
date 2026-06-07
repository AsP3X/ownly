# Ownly

Self-hosted personal cloud storage for documents, images, videos, audio, and more — similar to OneDrive, Google Drive, or MEGA, but under your control.

## Stack

- **Frontend:** Vite + React + TypeScript + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com)
- **Backend:** Rust (Axum)
- **Database:** PostgreSQL
- **Object storage:** [Nebular OS](https://github.com/AsP3X/nebular-os) — **git submodule** at `nebular-os/` (read-only in Ownly; bump the pinned commit to upgrade)

## Project setup

### 1. Clone the repository

Prefer a recursive clone so the Nebular OS submodule is populated immediately:

```bash
git clone --recurse-submodules <repository-url>
cd ownly
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

### 2. Initialize the `nebular-os` submodule (required)

Docker builds **`object-storage`** (and optional **`object-storage-b`**) from the **`nebular-os/`** submodule using **`docker/nebular-os.Dockerfile`** (includes `migrations/` for compile-time SQL; sync with upstream `nebular-os/Dockerfile` when bumping the pin). An empty `nebular-os/` folder will break Compose with:

```text
failed to read dockerfile: open Dockerfile: no such file or directory
```

After `git submodule update --init --recursive`, confirm the checkout:

```bash
# Unix / Git Bash
test -f nebular-os/Dockerfile && wc -c < nebular-os/Dockerfile
git submodule status
```

```powershell
# Windows PowerShell
Test-Path .\nebular-os\Dockerfile
(Get-Item .\nebular-os\Dockerfile).Length   # expect ~1300 bytes, not 0–2
git submodule status
```

You should see `nebular-os/Dockerfile` on disk and `git submodule status` showing a commit hash (no leading `-` on the `nebular-os` line).

Install Git hooks (blocks accidental commits under `nebular-os/`):

```bash
./scripts/install-git-hooks.sh
```

**Nebular changes** belong in [AsP3X/nebular-os](https://github.com/AsP3X/nebular-os). To export local submodule diffs for upstream: `./scripts/nebular-export-patch.sh`.

Pinned submodule commit (update with `git add nebular-os` after checkout): see `git rev-parse :nebular-os` (pin to a release tag such as `v0.1.4` for flat encoded blob paths).

## Quick start (Docker)

Start the full stack with **no configuration** — no `.env`, no `init-env`, no exports. Secrets are baked into `docker-compose.yml`. Run submodule init first if you skipped it during clone:

```bash
git submodule update --init --recursive
docker compose up --build
```

Open **http://localhost:8080** (or your host port mapping). Optional: change public media URLs via `OBJECT_STORAGE_PUBLIC_URL` in `docker-compose.yml` when not using localhost.

**Optional second storage node** (local admin testing with two Nebular instances):

```bash
git submodule update --init --recursive   # same requirement — both nodes build from nebular-os/
docker compose -f docker-compose.yml -f docker-compose.rep.yml up --build
```

Node B is exposed on **http://localhost:9001**; register it in Admin → Add Storage Node with `http://object-storage-b:9000` inside the Compose network. See comments in `docker-compose.rep.yml`.

For non-Docker development or production-like random secrets, run `init-env.sh` once (or `docker compose --profile init run --rm init-env`) to generate `.env` files from the examples.

**Disk tuning:** Nebular zstd levels, recompression, and HLS ingest quality are documented in [`docs/storage-disk-tuning.md`](docs/storage-disk-tuning.md) (Compose env vars in `.env.example`).

Open **http://localhost:8080** — the onboarding wizard runs on first launch.

| Service | URL |
|---------|-----|
| Web UI | http://localhost:8080 |
| API | http://localhost:3000/api/v1 |
| Nebular OS | http://localhost:9000 |
| PostgreSQL | localhost:5432 |

## Onboarding

The setup wizard configures:

1. **Admin account** — root administrator
2. **Instance settings** — name, public registration, account approval
3. **Object storage** — bucket name and default per-user quota
4. **PostgreSQL** — connection test before first run completes

After setup you land in the drive UI where you can upload, search, download, and delete files.

## Local development

### Backend

```bash
cd backend
cp .env.example .env   # or use root init-env.sh
cargo run
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api/v1` to `http://localhost:3000`.

### Audit & testing scripts (Python)

Security probes (SEC-00x) and the storage audit helper live under `scripts/`. They are designed to be runnable against any deployment (including local Docker) and have their own unit tests (no backend required for most tests).

See [`scripts/security-audit/README.md`](scripts/security-audit/README.md) for full details.

**One-time setup (macOS / Linux / Windows):**
```bash
bash scripts/setup-test-env.sh     # or scripts\setup-test-env.bat on Windows
source scripts/.venv/bin/activate  # (or the Windows equivalent)
python -m unittest discover -s scripts/security-audit/tests -v
```

The same venv also gives you `psycopg` for `scripts/storage-audit.py` (see `docs/storage-disk-tuning.md`).

## Project structure

```
.
├── backend/          # Rust Axum API
├── frontend/         # Vite + React + shadcn/ui
├── nebular-os/       # Nebular OS (git submodule — do not edit here)
├── docker-compose.yml
├── init-env.sh
└── .cursor/rules/    # Agent rules for this repo
```

## Environment variables

See `.env.example` and `backend/.env.example` for the full list. Secrets must be at least 32 characters — `init-env.sh` generates them automatically.
