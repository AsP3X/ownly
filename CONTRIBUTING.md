# Contributing to Ownly

Thank you for improving Ownly. This document summarizes how to work in the monorepo safely.

## Prerequisites

- Docker (for the default stack)
- Rust toolchain (backend)
- Node.js 22+ (frontend)
- PostgreSQL when running backend integration tests locally

## Branch flow

1. Branch from up-to-date `dev`: `feature/<short-name>`
2. Open a pull request into `dev`
3. Release line merges `dev` → `master`

## Local verification

```bash
# Backend (requires DATABASE_URL)
cd backend && cargo test -p ownly-backend && cargo clippy -p ownly-backend -- -D warnings

# Frontend
cd frontend && npm ci && npm run lint && npm run test && npm run build

# Security audit unit tests
make -C scripts/security-audit test
```

CI runs the same checks on pull requests (see `.github/workflows/ci.yml`).

## Nebular OS (object storage)

`nebular-os/` is a **read-only git submodule**. Storage service changes belong in [github.com/AsP3X/nebular-os](https://github.com/AsP3X/nebular-os). Ownly integration (Compose env, HTTP client, docs) lives in this repo only.

## Migrations

Add **new** sequentially numbered SQL files under `backend/migrations/postgres/`. Never edit migrations that have already been applied.

## Commits

Use prefixes: `TASK:`, `FIX:`, `BUGFIX:`, `DOCS:`, or `CHORE:`.

## Data safety

Do not run `docker compose down -v` or other destructive database commands unless you explicitly intend to wipe local data.
