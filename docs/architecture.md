# Architecture overview

← [Back to main README](../README.md) · [Documentation index](./README.md)

High-level picture of how Ownly fits together. Implementation details live in the backend/frontend code and specialized docs.

## Stack

| Layer | Technology |
|-------|------------|
| Web UI | Vite + React + TypeScript + Tailwind + [shadcn/ui](https://ui.shadcn.com) |
| API | Rust ([Axum](https://github.com/tokio-rs/axum)) |
| Metadata DB | PostgreSQL |
| Object storage | [Nebular OS](https://github.com/AsP3X/nebular-os) (git submodule) |
| Edge (Compose) | nginx in the frontend image — static assets + reverse proxy |
| Mobile | Native iOS client (`ios/`) |

## Request path (Compose)

```
Browser
  → :8080 frontend/nginx
       → /api/v1/*  → backend :3000
       → /media/*   → object-storage :9000  (presigned GET/PUT)
  → (optional) API direct :3000 for local debug
```

Presigned download and direct-upload URLs should use **`OBJECT_STORAGE_PUBLIC_URL`** on the same origin as the UI when possible (`connect-src 'self'`, no Nebular CORS). See [Configuration](./configuration.md).

## Data ownership

| Store | Owns |
|-------|------|
| **PostgreSQL** | Users, sessions, folders, `files` rows, shares, jobs, upload sessions, quotas, placement metadata |
| **Nebular** | Opaque blobs keyed by Ownly `storage_key` (and staging/HLS segment keys) |
| **API temp (`TMPDIR`)** | In-flight video spools and job workdirs — **not** durable; not in full backups |

A complete backup needs **both** Postgres and Nebular volumes: [Backup and restore](./backup-restore.md).

## Major product flows

| Flow | Summary |
|------|---------|
| **Upload** | Small files: multipart `POST /files/upload`. Large/video: resumable `POST /uploads` + parts + complete; non-video can direct-PUT to Nebular. See [Resumable uploads](./resumable-upload-improvements.md). |
| **Download** | Stream via API or short-lived presigned Nebular URL |
| **Video** | HLS encode job → encrypted segments in storage; playlist/key endpoints on the API |
| **Shares** | Public token links and user-to-user grants ([atomic permissions](./superpowers/specs/2026-05-25-atomic-permissions-design.md)) |
| **Live collab** | Shared server-authoritative OT engine for RTF + spreadsheets — [Collab engine](./collab-engine.md) |
| **Admin** | Users, storage nodes, migration, upload health, system settings |

## Multi-node storage

Optional extra Nebular nodes (`docker-compose.rep.yml`) register in Admin. Ownly places new objects by capacity and may stripe overflow. Design notes: [Nebular metadata prompt](./nebular-os-storage-metadata-prompt.md).

## Repo layout

```
.
├── backend/             # Rust API + migrations
├── frontend/            # Web app
├── nebular-os/          # Object storage submodule (read-only here)
├── ios/                 # Native iOS client
├── docker/              # Extra Dockerfiles (e.g. Nebular image)
├── docker-compose*.yml  # Base + overlays
├── scripts/             # Backup, audit, Compose helpers
└── docs/                # This documentation tree
```

## Related

- [Getting started](./getting-started.md)
- [Nebular integration](./nebular-integration.md)
- [Collab engine](./collab-engine.md)
- [API](./api.md)
- [Improvement roadmap](./improvement-roadmap.md)
