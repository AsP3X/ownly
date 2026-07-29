# Local development

← [Back to main README](../README.md) · [Documentation index](./README.md)

Run services individually when iterating on the API or web UI without rebuilding full Compose images every time.

For a zero-config full stack, prefer [Getting started](./getting-started.md) (`docker compose up --build`).

## Prerequisites

- Docker (Postgres + Nebular still recommended via Compose)
- **Rust** toolchain (backend)
- **Node.js 22+** (frontend)
- See also [Contributing](../CONTRIBUTING.md)

## Backend

```bash
cd backend
cp .env.example .env   # or use root ./init-env.sh
# Point DATABASE_URL and OBJECT_STORAGE_* at your running Compose services
cargo run
```

API listens on **http://localhost:3000** by default (`BIND_ADDR`).

Requires:

- PostgreSQL reachable at `DATABASE_URL`
- Nebular OS reachable at `OBJECT_STORAGE_URL`

Typical hybrid: start only infrastructure with Compose:

```bash
docker compose up -d postgres object-storage
cd backend && cargo run
```

### Backend verification

```bash
cd backend
cargo test -p ownly-backend
cargo clippy -p ownly-backend -- -D warnings
```

Integration tests that hit Postgres need:

```bash
export DATABASE_URL='postgres://ownly:…@127.0.0.1:5432/ownly'
# Optional: fail instead of skip when DB missing
export OWNLY_REQUIRE_DATABASE_URL=1
cargo test --test http_integration
```

## Frontend

```bash
cd frontend
npm install   # or npm ci
npm run dev
```

Vite proxies `/api/v1` to `http://localhost:3000`. Open the printed local URL (usually **http://localhost:5173**).

### Frontend verification

```bash
cd frontend
npm run lint
npm run test
npm run build
```

## Full-stack verification matrix

| Area | Command |
|------|---------|
| Backend unit/lib tests | `cd backend && cargo test -p ownly-backend` |
| Backend lint | `cd backend && cargo clippy -p ownly-backend -- -D warnings` |
| Frontend lint / unit / build | `cd frontend && npm run lint && npm run test && npm run build` |
| Security audit unit tests | `make -C scripts/security-audit test` (after `scripts/setup-test-env.sh`) |

CI runs the same family of checks on pull requests (`.github/workflows/ci.yml`).

## Migrations

Add **new** sequentially numbered SQL files under `backend/migrations/postgres/`.  
Never edit migrations that have already been applied to shared environments.

## Data safety

- Prefer `./scripts/compose-dev-down.sh` over `docker compose down -v`
- Take a [backup](./backup-restore.md) before destructive experiments

## Related

- [Configuration](./configuration.md)
- [Compose profiles](./compose-profiles.md)
- [Contributing](../CONTRIBUTING.md)
- [API](./api.md)
