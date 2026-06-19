# Ownly

Self-hosted personal cloud storage for documents, images, videos, audio, and more — similar to OneDrive, Google Drive, or MEGA, but under your control.

## Quick start

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and [Git](https://git-scm.com/downloads) with submodule support.

```bash
git clone --recurse-submodules <repository-url>
cd ownly
docker compose up --build
```

Open **http://localhost:8080**. On first launch, the setup wizard creates your admin account and wires Postgres + object storage. No `.env` file or `init-env` step is required for local Docker — secrets are baked into `docker-compose.yml` for zero-config dev.

| Service | URL |
|---------|-----|
| Web UI | http://localhost:8080 |
| API | http://localhost:3000/api/v1 |
| Nebular OS (object storage) | http://localhost:9000 |
| PostgreSQL | localhost:5432 (`ownly` / `ownly`) |

**Stop the stack** (keeps your data):

```bash
./scripts/compose-dev-down.sh
```

Do **not** run `docker compose down -v` unless you intend to wipe the local Postgres and blob volumes.

---

## First-run wizard

The onboarding flow at `/setup` configures:

1. **Admin account** — root administrator
2. **Instance settings** — name, public registration, account approval
3. **Object storage** — bucket name and default per-user quota
4. **PostgreSQL** — connection test before setup completes

After setup you land in the drive UI: upload, search, download, delete, share links, and admin tools.

---

## Clone without submodules?

If you already cloned without `--recurse-submodules`, initialize Nebular OS before `docker compose up`:

```bash
git submodule update --init --recursive
```

An empty `nebular-os/` folder breaks the build with `failed to read dockerfile`. Confirm the checkout:

```bash
# Unix / Git Bash
test -f nebular-os/Dockerfile && git submodule status

# Windows PowerShell
Test-Path .\nebular-os\Dockerfile
git submodule status
```

You should see `nebular-os/Dockerfile` on disk and `git submodule status` showing a commit hash (no leading `-` on the `nebular-os` line).

Install Git hooks (blocks accidental commits under the read-only submodule):

```bash
./scripts/install-git-hooks.sh
```

---

## Configuration

### Local Docker (default)

Edit values directly in `docker-compose.yml` when you need custom secrets or public URLs. Host `.env` files do **not** override the baked-in dev secrets in Compose — that is intentional for predictable local runs.

Common overrides (set in shell or a `.env` file read by Compose for non-secret vars):

| Variable | Purpose |
|----------|---------|
| `OBJECT_STORAGE_PUBLIC_URL` | Browser base for presigned media URLs (default `http://localhost:8080`) |
| `MAX_UPLOAD_BYTES` | Upload size cap for API, nginx, and Nebular (default 10 GiB) |
| `OWNLY_ENVIRONMENT` | Set `production` on real deployments |

### Production or non-Docker dev

Generate `.env` files with random secrets (minimum 32 characters):

```bash
./init-env.sh
# or: docker compose --profile init run --rm init-env
```

Copies `.env.example` → `.env` and `backend/.env.example` → `backend/.env`, replacing `GENERATE_ME` placeholders. See `.env.example` and `backend/.env.example` for the full list.

**Production database:** use managed PostgreSQL (RDS, Cloud SQL, etc.) with backups — not a Docker volume. Set `OWNLY_ENVIRONMENT=production` on API hosts.

**Secure deployment:** see [`docs/secure-deployment.md`](docs/secure-deployment.md) for firewall, secrets, CORS, and the production Compose overlay (`docker-compose.prod.yml`).

**Disk and HLS tuning:** zstd levels, recompression, and video ingest quality — [`docs/storage-disk-tuning.md`](docs/storage-disk-tuning.md).

---

## Local development (without full Compose)

Run services individually when iterating on frontend or backend code.

### Backend

```bash
cd backend
cp .env.example .env   # or use root init-env.sh
cargo run
```

API listens on **http://localhost:3000**. Requires Postgres and Nebular OS reachable at the URLs in `.env`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite dev server proxies `/api/v1` to `http://localhost:3000`.

### Verification

| Area | Command |
|------|---------|
| Backend tests | `cd backend && cargo test` |
| Backend lint | `cd backend && cargo clippy -p ownly-backend -- -D warnings` |
| Frontend build | `cd frontend && npm run build && npm run lint` |

---

## Optional Compose profiles

**Production overlay** (no host ports on Postgres/object storage/API; hardened defaults):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

Requires `POSTGRES_PASSWORD`, `CORS_ALLOWED_ORIGINS`, and unique secrets. See [`docs/secure-deployment.md`](docs/secure-deployment.md).

**Second storage node** (admin testing with two Nebular instances):

```bash
docker compose -f docker-compose.yml -f docker-compose.rep.yml up --build
```

Node B is on **http://localhost:9001**. Register it in Admin → Add Storage Node with `http://object-storage-b:9000` inside the Compose network. See comments in `docker-compose.rep.yml`.

**GPU HLS ingest** (NVIDIA NVENC):

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Requires the NVIDIA Container Toolkit. See `HLS_HARDWARE_ENCODE` in `.env.example`.

---

## Nebular OS (object storage submodule)

[Nebular OS](https://github.com/AsP3X/nebular-os) lives at `nebular-os/` as a **git submodule**. Ownly pins a specific commit; bump the pointer after upstream releases:

```bash
cd nebular-os && git fetch && git checkout <tag-or-sha>
cd .. && git add nebular-os && git commit -m "CHORE: Bump nebular-os to <tag-or-sha>"
```

**Do not edit files under `nebular-os/` in this repo.** Storage service changes belong in [AsP3X/nebular-os](https://github.com/AsP3X/nebular-os). Export local diffs for upstream with `./scripts/nebular-export-patch.sh`.

Docker builds `object-storage` from `nebular-os/` using `docker/nebular-os.Dockerfile`.

---

## Project structure

```
.
├── backend/           # Rust Axum API
├── frontend/        # Vite + React + shadcn/ui
├── nebular-os/        # Nebular OS (git submodule — read-only here)
├── ios/               # Native iOS client (see ios/README.md)
├── docker-compose.yml
├── init-env.sh
├── scripts/           # Compose helpers, security audit, storage audit
└── docs/              # Storage tuning and design notes
```

## Stack

- **Frontend:** Vite + React + TypeScript + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com)
- **Backend:** Rust (Axum)
- **Database:** PostgreSQL
- **Object storage:** [Nebular OS](https://github.com/AsP3X/nebular-os)

---

## Further reading

| Topic | Location |
|-------|----------|
| Secure deployment checklist | [`docs/secure-deployment.md`](docs/secure-deployment.md) |
| Storage disk tuning | [`docs/storage-disk-tuning.md`](docs/storage-disk-tuning.md) |
| Security audit probes (SEC-00x) | [`scripts/security-audit/README.md`](scripts/security-audit/README.md) |
| iOS client | [`ios/README.md`](ios/README.md) |
| Storage audit helper | `scripts/storage-audit.py` (needs Python venv from `scripts/setup-test-env.sh`) |

**Security audit one-time setup:**

```bash
bash scripts/setup-test-env.sh     # Windows: scripts\setup-test-env.bat
source scripts/.venv/bin/activate  # Windows: scripts\.venv\Scripts\activate
python -m unittest discover -s scripts/security-audit/tests -v
```
