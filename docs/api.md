# HTTP API

← [Back to main README](../README.md) · [Documentation index](./README.md)

Ownly exposes a versioned JSON HTTP API under **`/api/v1`**.

## OpenAPI specification

The machine-readable contract lives at:

**[`docs/api-openapi.yaml`](./api-openapi.yaml)**

Import it into Swagger UI, Redoc, Insomnia, or Postman for exploration.

## Base URLs (local Compose)

| Entry | Base |
|-------|------|
| Via nginx (recommended) | `http://localhost:8080/api/v1` |
| Direct to API | `http://localhost:3000/api/v1` |

## Auth

- Session cookie and/or `Authorization: Bearer <JWT>` depending on client.
- Browser mutations require CSRF headers (see frontend `api` client and backend `csrf` module).
- First-run setup is gated by `SETUP_TOKEN` until the instance is configured.

## Major route groups (overview)

| Prefix | Purpose |
|--------|---------|
| `/auth/*` | Register, login, refresh, logout, me |
| `/files/*` | List, upload, download, rename, delete, search, version history |
| `/uploads/*` | Resumable chunked upload sessions |
| `/folders/*` | Folder tree |
| `/shares/*` · `/public/shares/*` | User and public share links |
| `/jobs/*` | Background job status |
| `/admin/*` | Admin console APIs |
| `/setup/*` | First-run bootstrap |

Exact paths and schemas: OpenAPI file above and route registration in `backend/src/lib.rs`.

## Clients

| Client | Notes |
|--------|--------|
| Web app | `frontend/src/api/` |
| iOS | `ios/Ownly/` — see [`ios/README.md`](../ios/README.md) |

## Related

- [Architecture](./architecture.md)
- [Resumable uploads](./resumable-upload-improvements.md)
- [Local development](./local-development.md)
- [Secure deployment](./secure-deployment.md)
