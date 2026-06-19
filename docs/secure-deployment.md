# Secure deployment checklist

Use this checklist before exposing Ownly on the public internet. It complements [`security-audit.md`](security-audit.md) (SEC-027).

## Before you expose port 443 (or any public HTTP)

1. **Firewall** — Allow only the reverse proxy (or frontend) port. Block direct access to Postgres, object storage, and the API process on the host.
2. **Secrets** — Run `./init-env.sh` (or `docker compose --profile init run --rm init-env`) and replace every `GENERATE_ME` / dev literal with unique values (`openssl rand -hex 32`). Never use committed Compose dev secrets in production.
3. **`OWNLY_ENVIRONMENT=production`** — Required on API hosts. Rejects Compose dev secrets and requires explicit CORS origins at startup.
4. **`CORS_ALLOWED_ORIGINS`** — Set comma-separated browser origins (e.g. `https://app.example.com`). Empty or permissive CORS is not allowed in production.
5. **`TRUST_PROXY_HEADERS`** — Default `false`. Set `true` only when the API is **solely** reachable through a trusted reverse proxy that sets `X-Forwarded-For` / `X-Real-IP` (e.g. nginx in the Compose stack).
6. **`OWNLY_ALLOW_PRIVATE_OUTBOUND`** — Default `0`. Do not enable in production unless you have a documented need for setup probes to private hosts.
7. **Database** — Use managed PostgreSQL with backups. Set a strong `POSTGRES_PASSWORD` (not `ownly` or Compose dev literals).
8. **Setup** — Complete first-run setup before advertising the URL. `SETUP_TOKEN` gates setup mutations until the instance is configured.

## Docker Compose (production overlay)

For Compose-based deployments, merge the production overlay so Postgres and object storage are not published on the host:

```bash
export POSTGRES_PASSWORD="$(openssl rand -hex 32)"
export CORS_ALLOWED_ORIGINS="https://your-domain.example"
export JWT_SECRET="$(openssl rand -hex 32)"
export SETUP_TOKEN="$(openssl rand -hex 32)"
export SIGNING_SECRET="$(openssl rand -hex 32)"
export OBJECT_STORAGE_JWT_SECRET="$(openssl rand -hex 32)"
export NOS_JWT_SECRET="$(openssl rand -hex 32)"
export NOS_SIGNING_SECRET="$(openssl rand -hex 32)"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

The overlay:

- Removes host port bindings for Postgres, object storage, and the API (frontend/nginx remains the entrypoint).
- Sets `OWNLY_ENVIRONMENT=production`, `TRUST_PROXY_HEADERS=true` (nginx is the trusted proxy), and `OWNLY_ALLOW_PRIVATE_OUTBOUND=0`.
- Requires `POSTGRES_PASSWORD` and `CORS_ALLOWED_ORIGINS`.

Optional profiles (merge as needed):

| Overlay | Purpose |
|---------|---------|
| `docker-compose.prod.yml` | Production networking and hardened defaults |
| `docker-compose.gpu.yml` | NVIDIA NVENC for HLS ingest |
| `docker-compose.rep.yml` | Second Nebular node — set `OWNLY_ALLOW_PRIVATE_OUTBOUND=1` only if registering internal node URLs |

## Local development (default Compose)

Default `docker-compose.yml` is for **local development**:

- Postgres/object storage ports `5432` / `9000` are exposed for debugging.
- Dev-only secret literals and a long dev Postgres password are baked in — not for production.
- `TRUST_PROXY_HEADERS` defaults to `false` (set `true` if you need per-client rate limits through nginx on port 8080).
- `OWNLY_ALLOW_PRIVATE_OUTBOUND` defaults to `0` (set `1` for setup tests or multi-node admin against internal Docker hostnames).

Verify injected secrets before recreating containers:

```bash
sh scripts/verify-compose-secrets.sh
docker compose config | grep -E 'POSTGRES_PASSWORD|TRUST_PROXY_HEADERS|OWNLY_ALLOW_PRIVATE_OUTBOUND'
```

## Verification

| Check | Command |
|-------|---------|
| Compose secrets | `sh scripts/verify-compose-secrets.sh` |
| API startup (production profile) | API logs should not show secret/CORS rejections |
| Setup bootstrap gate | `python3 scripts/security-audit/sec005_setup_bootstrap_race.py` |
