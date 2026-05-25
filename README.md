# MediaVault

Self-hosted personal cloud storage for documents, images, videos, audio, and more — similar to OneDrive, Google Drive, or MEGA, but under your control.

## Stack

- **Frontend:** Vite + React + TypeScript + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com)
- **Backend:** Rust (Axum)
- **Database:** PostgreSQL
- **Object storage:** [Nebular OS](https://github.com/AsP3X/nebular-os) (included under `nebular-os/`) — transparent zstd compression on write, store-if-smaller encoding, soft-delete blob reclamation, and background recompression of legacy raw blobs

## Quick start (Docker)

Generate secrets once:

```bash
chmod +x init-env.sh
docker compose --profile init run --rm init-env
```

Start the full stack:

```bash
docker compose up --build
```

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

## Project structure

```
.
├── backend/          # Rust Axum API
├── frontend/         # Vite + React + shadcn/ui
├── nebular-os/       # Object storage service
├── docker-compose.yml
├── init-env.sh
└── .cursor/rules/    # Agent rules for this repo
```

## Environment variables

See `.env.example` and `backend/.env.example` for the full list. Secrets must be at least 32 characters — `init-env.sh` generates them automatically.
