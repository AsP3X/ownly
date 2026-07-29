# Docker Compose profiles and overlays

← [Back to main README](../README.md) · [Documentation index](./README.md)

Ownly uses a base compose file plus optional overlays.

| File | Role |
|------|------|
| `docker-compose.yml` | Default local stack (dev secrets, host ports for debug) |
| `docker-compose.prod.yml` | Production networking + hardened defaults |
| `docker-compose.rep.yml` | Second Nebular node for multi-node admin testing |
| `docker-compose.gpu.yml` | NVIDIA NVENC for HLS ingest |

Merge files with repeated `-f` flags (order matters: base first).

## Default (development)

```bash
docker compose up --build
```

Exposes Postgres `5432`, Nebular `9000`, API `3000`, web `8080`.  
See [Getting started](./getting-started.md) and [Secure deployment](./secure-deployment.md) (local section).

## Production overlay

No host ports on Postgres, object storage, or the API. Users reach the app via the frontend/nginx service only.

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

The overlay sets `OWNLY_ENVIRONMENT=production`, `TRUST_PROXY_HEADERS=true` (nginx is the trusted proxy), and `OWNLY_ALLOW_PRIVATE_OUTBOUND=0`.

Full checklist: [Secure deployment](./secure-deployment.md).

## Second storage node (replication / multi-node testing)

```bash
docker compose -f docker-compose.yml -f docker-compose.rep.yml up --build
```

| Node | Host port | In-network URL for Ownly admin |
|------|-----------|--------------------------------|
| Primary `object-storage` | http://localhost:9000 | `http://object-storage:9000` |
| Node B `object-storage-b` | http://localhost:9001 | `http://object-storage-b:9000` |

Register node B in **Admin → Add Storage Node** with the in-network URL and a target capacity.  
Ownly routes by remaining capacity; see [Nebular metadata notes](./nebular-os-storage-metadata-prompt.md).

For production multi-node, merge `docker-compose.prod.yml` as well (node-b host port is removed).

## GPU HLS ingest (NVIDIA)

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).  
Tune with `HLS_HARDWARE_ENCODE` (`auto` \| `nvenc` \| …) — see [Configuration](./configuration.md) and `.env.example`.

## Init profile (secrets generation)

```bash
docker compose --profile init run --rm init-env
# equivalent host script:
./init-env.sh
```

## Backup with overlays

```bash
./scripts/backup-ownly.sh -f docker-compose.yml -f docker-compose.prod.yml
```

See [Backup and restore](./backup-restore.md).

## Related

- [Configuration](./configuration.md)
- [Secure deployment](./secure-deployment.md)
- [Nebular integration](./nebular-integration.md)
