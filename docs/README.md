# Ownly documentation

← [Back to main README](../README.md)

This folder holds setup, configuration, operations, and design notes for Ownly.  
The [root README](../README.md) is the project overview and quick entry point.

---

## Start here

| Guide | Description |
|-------|-------------|
| [Getting started](./getting-started.md) | Clone, Docker Compose up, first-run wizard, submodules |
| [Configuration](./configuration.md) | Environment variables, secrets, local vs production config |
| [Architecture](./architecture.md) | Stack overview, data stores, request paths |
| [Local development](./local-development.md) | Backend, frontend, tests, verification commands |
| [Compose profiles](./compose-profiles.md) | Production, multi-node, and GPU overlays |
| [Backup and restore](./backup-restore.md) | Full Postgres + Nebular disaster recovery |
| [Secure deployment](./secure-deployment.md) | Internet-facing checklist, CORS, firewall, secrets |

---

## Operations & storage

| Guide | Description |
|-------|-------------|
| [Storage disk tuning](./storage-disk-tuning.md) | Nebular zstd, scrub, HLS quality env knobs |
| [Storage disk improvements](./storage-disk-improvements.md) | Disk-savings roadmap (dedup, lazy export, cleanup) |
| [Resumable upload improvements](./resumable-upload-improvements.md) | Chunked upload design and follow-ups |
| [Nebular OS integration](./nebular-integration.md) | Submodule pin, vendor boundary, bump process |
| [Nebular metadata mode prompt](./nebular-os-storage-metadata-prompt.md) | Upstream Nebular work for Ownly placement/quotas |
| [App settings secrets migration](./app-settings-secrets-migration.md) | SEC-032 encrypted settings notes |

---

## Product & engineering notes

| Guide | Description |
|-------|-------------|
| [Improvement roadmap](./improvement-roadmap.md) | Remaining product and platform gaps |
| [Excel editor feature parity](./excel-editor-feature-parity.md) | Spreadsheet editor status tracker |
| [API (OpenAPI)](./api.md) | HTTP API reference (`api-openapi.yaml`) |
| [Contributing](../CONTRIBUTING.md) | Branch flow, CI checks, commit style |
| [Security audit report](../security-audit.md) | Historical SEC findings and fixes |
| [Security audit probes](../scripts/security-audit/README.md) | Runnable SEC-00x scripts |

### Design specs & plans (`docs/superpowers/`)

| Document | Description |
|----------|-------------|
| [Atomic permissions design](./superpowers/specs/2026-05-25-atomic-permissions-design.md) | ACL model |
| [Me sessions design](./superpowers/specs/2026-07-23-me-sessions-design.md) | Authorized sessions UX |
| [Excel 365 full parity plan](./superpowers/plans/2026-06-08-excel-365-full-parity.md) | Spreadsheet roadmap |
| [EPUB reader plan](./superpowers/plans/2026-07-12-epub-reader.md) | EPUB reader |
| [EPUB grid thumbnails plan](./superpowers/plans/2026-07-12-epub-grid-thumbnails.md) | EPUB covers |

Pencil UI sources live under [`docs/design/`](./design/) (not prose docs).

---

## License

| Document | Description |
|----------|-------------|
| [LICENSE](../LICENSE) | Ownly Private Non-Commercial License (NOCL-1.0) — full legal terms |
| [COMMERCIAL-LICENSE.md](../COMMERCIAL-LICENSE.md) | How to request commercial / for-profit licensing |

Ownly is **source-available**, not OSI-approved open source. Private non-commercial
use by individuals (and qualifying non-profits) is free under NOCL-1.0; any for-profit
or redistributive use needs a written commercial agreement.

## Clients

| Client | Location |
|--------|----------|
| Web (this monorepo) | [`frontend/`](../frontend/) · notes in [local development](./local-development.md) |
| iOS | [`ios/README.md`](../ios/README.md) |

---

## Scripts (operations)

| Script | Purpose |
|--------|---------|
| [`scripts/backup-ownly.sh`](../scripts/backup-ownly.sh) | Full backup |
| [`scripts/restore-ownly.sh`](../scripts/restore-ownly.sh) | Destructive restore |
| [`scripts/compose-dev-down.sh`](../scripts/compose-dev-down.sh) | Stop stack (keep volumes) |
| [`scripts/verify-compose-secrets.sh`](../scripts/verify-compose-secrets.sh) | Check Compose secrets |
| [`scripts/storage-audit.py`](../scripts/storage-audit.py) | Logical vs on-disk bytes |
| [`scripts/install-git-hooks.sh`](../scripts/install-git-hooks.sh) | Block accidental submodule commits |
