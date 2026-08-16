# Configuration

← [Back to main README](../README.md) · [Documentation index](./README.md)

How Ownly is configured in local Compose, production Compose, and bare-metal / non-Docker runs.

## Two configuration modes

| Mode | Secrets source | Typical use |
|------|----------------|-------------|
| **Local Docker (default)** | `${SECRET:-compose-dev-literal}` in `docker-compose.yml` | Day-to-day development |
| **Production / non-Docker** | `.env` from `./init-env.sh` + overlays | Internet-facing or custom hosts |

### Local Docker

Edit `docker-compose.yml` when you need custom **public URLs** or other non-secret tuning. After `./init-env.sh`, the generated `.env` **does** supply `SETUP_TOKEN` / JWT / signing secrets (Compose interpolates `${SETUP_TOKEN:-…}`). Without a `.env`, the committed development literals are used.

If a secret is exported as an empty string in your shell, it overrides `.env` — run `./scripts/compose-up.sh` (or `unset SETUP_TOKEN JWT_SECRET …`) before `docker compose up`.

Common overrides (shell or Compose-read `.env` for non-secret vars):

| Variable | Purpose | Default (dev) |
|----------|---------|----------------|
| `OBJECT_STORAGE_PUBLIC_URL` | Browser base for presigned media (nginx `/media/`) | `http://localhost:8080` |
| `FRONTEND_PORT` | Host port published by frontend/nginx (`:80` in the container). Local Compose only — the production overlay publishes no host ports (Nginx Proxy Manager / Traefik on `proxy-network` → `ownly-frontend:80`) | `8080` |
| `MAX_UPLOAD_BYTES` | Upload cap for API, in-stack nginx, and Nebular. An outer proxy (Nginx Proxy Manager) has its own `client_max_body_size` (default 1MB) and must be raised separately | 10 GiB |
| `OWNLY_ENVIRONMENT` | `development` or `production` | `development` |
| `UPLOAD_RPM` | Per-user upload request budget per minute | `1200` |
| `TRUST_PROXY_HEADERS` | Trust `X-Forwarded-*` for rate limits | `false` (set `true` only behind trusted proxy) |
| `OWNLY_ALLOW_PRIVATE_OUTBOUND` | Allow setup/admin probes to private hosts | `1` in default Compose |
| `HLS_HARDWARE_ENCODE` | `auto` \| `off` \| `nvenc` \| `vaapi` \| `qsv` | `auto` |
| `RUST_LOG` | Backend log level | `debug` |

Storage and Nebular tuning knobs (zstd, scrub, recompress) are documented in [Storage disk tuning](./storage-disk-tuning.md).

### Production or non-Docker

Generate `.env` files with random secrets (minimum 32 characters):

```bash
./init-env.sh
# or: docker compose --profile init run --rm init-env
```

This copies `.env.example` → `.env` and `backend/.env.example` → `backend/.env`, replacing `GENERATE_ME` placeholders.

**Required strong secrets (never commit real values):**

| Variable | Role |
|----------|------|
| `JWT_SECRET` | Access token signing |
| `SETUP_TOKEN` | Gates first-run setup mutations |
| `SIGNING_SECRET` / `NOS_SIGNING_SECRET` | Presigned URL HMAC (must match across API + Nebular) |
| `OBJECT_STORAGE_JWT_SECRET` / `NOS_JWT_SECRET` | Nebular API JWT |
| `POSTGRES_PASSWORD` | Database (production) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins (required when `OWNLY_ENVIRONMENT=production`) |

Full lists: [`.env.example`](../.env.example) and [`backend/.env.example`](../backend/.env.example).

### Production Compose

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

Requires strong `POSTGRES_PASSWORD`, unique secrets, and `CORS_ALLOWED_ORIGINS`. Details: [Secure deployment](./secure-deployment.md) and [Compose profiles](./compose-profiles.md).

Prefer **managed PostgreSQL** with provider backups in production. Still run Ownly [backups](./backup-restore.md) for Nebular blob volumes (and for Compose Postgres if you do not use a managed DB).

## Database URL

| Context | Example |
|---------|---------|
| Inside Compose network | `postgres://ownly:…@postgres:5432/ownly` |
| Host tools / integration tests | `postgres://ownly:…@127.0.0.1:5432/ownly` |

Backend reads `DATABASE_URL`. Migrations under `backend/migrations/postgres/` apply on API startup.

## Object storage URLs

| Variable | Audience |
|----------|----------|
| `OBJECT_STORAGE_URL` | API → Nebular (Docker DNS: `http://object-storage:9000`) |
| `OBJECT_STORAGE_PUBLIC_URL` | **Browsers** for presigned GET/PUT (usually same origin via nginx, e.g. `http://localhost:8080`) |
| `OBJECT_STORAGE_BUCKET` | Bucket name (default `media`) |

Mismatch between public URL and how users reach the app breaks downloads and direct upload parts. See [Resumable upload](./resumable-upload-improvements.md).

## Verify Compose secrets

```bash
sh scripts/verify-compose-secrets.sh
docker compose config | grep -E 'POSTGRES_PASSWORD|TRUST_PROXY_HEADERS|OWNLY_ALLOW_PRIVATE_OUTBOUND'
```

## Related

- [Getting started](./getting-started.md)
- [Secure deployment](./secure-deployment.md)
- [Storage disk tuning](./storage-disk-tuning.md)
- [Backup and restore](./backup-restore.md)
