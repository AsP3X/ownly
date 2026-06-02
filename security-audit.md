# Security Audit — Ownly / MediaVault Stack

**Date:** 2026-06-02  
**Scope:** Static code review of authentication, authorization, setup/bootstrap, file/share access, and admin mutation paths.  
**Method:** Backend route wiring, middleware, SQL access checks, share scope queries, and frontend API client alignment. No live penetration testing was performed.

Use the checkboxes below to track remediation as you work through each item.

---

## Executive summary

| Severity | Count | Open |
|----------|-------|------|
| High     | 3     | 3    |
| Medium   | 3     | 3    |
| Low      | 0     | 0    |

**Recommended fix order:** SEC-001 → SEC-002 → SEC-003 → SEC-004 → SEC-005 → SEC-006

---

## Findings

### SEC-001 — Public setup endpoints leak database credentials and infrastructure metadata

- [ ] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **Category** | Data extraction / information disclosure |
| **Impacted files** | `backend/src/setup/handlers.rs` (`setup_database_info`, `setup_storage_info`), `backend/src/lib.rs` (public route wiring) |
| **Routes** | `GET /api/v1/setup/database`, `GET /api/v1/setup/storage` |

**Description**

These endpoints are public and intentionally skip `ensure_not_complete`. They return the full `database_url` (often including username and password) and object-storage endpoint metadata even after setup is complete.

**Evidence**

```rust
// setup_database_info — NO ensure_not_complete
database_url: state.database_url.clone(),

// setup_storage_info — NO ensure_not_complete
object_storage_url, object_storage_public_url, object_storage_bucket, storage_mode
```

**Exploit scenario**

An unauthenticated attacker on the network calls `GET /api/v1/setup/database` and receives a connection string with credentials. They can use it for direct database access or targeted attacks against internal services.

**Impact**

Credential theft, infrastructure mapping, possible full database compromise if the URL is reachable from the attacker’s network.

**Remediation**

1. Restrict `setup/database` and `setup/storage` to pre-setup only (`ensure_not_complete`) **or** require authenticated admin.
2. Never return full `DATABASE_URL` with secrets in API responses — return driver/host only, or a redacted placeholder.
3. Consider removing these routes from the public router after first admin exists.

**Verification**

- [ ] Unauthenticated `GET /setup/database` returns 404/401 after setup (or redacted body only).
- [ ] No password material appears in JSON responses or audit logs.

---

### SEC-002 — Stale JWT role allows admin access after demotion

- [ ] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **Category** | Unauthorized action / privilege escalation |
| **Impacted files** | `backend/src/auth/mod.rs` (`auth_middleware`), `backend/src/admin/handlers.rs` (`require_admin`, `update_user`) |
| **Routes** | All `/api/v1/admin/*` protected routes |

**Description**

`require_admin` checks `claims.role` from the JWT. `auth_middleware` re-validates `users.enabled` and session revocation but **does not** reload `role` from the database. When an admin is demoted via `PATCH /api/v1/admin/users/{id}`, existing tokens are not invalidated for role changes.

**Evidence**

```rust
// auth_middleware — only enabled is checked
sqlx::query_as("SELECT enabled FROM users WHERE id = $1")

// require_admin — trusts JWT
if claims.role == "admin" { ... }
```

**Exploit scenario**

1. User has a valid admin JWT (up to ~24h TTL).
2. Another admin demotes them to `pro` or `standard` in the DB.
3. Demoted user continues calling admin APIs (create/delete users, patch settings, storage nodes) until token expiry or manual session revoke.

**Impact**

Unauthorized admin operations, user lifecycle changes, settings changes, and storage configuration changes.

**Remediation**

1. In `auth_middleware`, load `role` (and `enabled`) from DB and set claims from DB values before `next.run`.
2. On role change (especially `admin` → non-admin), revoke all sessions for that user (`user_sessions` epoch bump / sid invalidation).
3. On password reset via admin, revoke sessions (if not already).
4. Optionally shorten access-token lifetime for admin roles.

**Verification**

- [ ] After demotion, existing JWT receives 403 on `/api/v1/admin/*` immediately.
- [ ] Integration test: demote admin → prior token fails admin routes.

---

### SEC-003 — Soft-deleted files remain accessible via public share links

- [ ] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **Category** | Data extraction / unauthorized access |
| **Impacted files** | `backend/src/shares/store.rs` (`load_file_in_share_scope`, `list_share_folder_files`, `list_all_files_in_share`, `compute_share_tree_stats`, `folder_is_under_root`), `backend/src/shares/handlers.rs` (public share download/list/archive handlers) |
| **Routes** | `/api/v1/public/shares/{token}/*` |

**Description**

Share-scope queries filter by `user_id` and subtree membership but omit `deleted_at IS NULL` on `files` and `folders`. Recycle-bin soft delete does not cut off public share access.

**Evidence**

```sql
-- load_file_in_share_scope
FROM files WHERE id = $1 AND user_id = $2
-- (no deleted_at IS NULL)

-- folder_is_under_root
SELECT parent_id FROM folders WHERE id = $1 AND user_id = $2
-- (no deleted_at IS NULL)
```

**Exploit scenario**

1. Owner shares a folder via public link.
2. Owner deletes files/folders (moves to recycle bin).
3. Holder of the share token still lists and downloads “deleted” content via public share endpoints (`download`, `all-files`, archive jobs).

**Impact**

Data retention bypass; users believe deleted content is inaccessible but it remains extractable via share URL.

**Remediation**

1. Add `deleted_at IS NULL` (or reuse `ACTIVE_FILES_SQL` / `ACTIVE_FOLDERS_SQL` from `files/recycle_bin.rs`) to all share-scope file and folder queries.
2. If shared root file/folder is deleted, return `404` for share overview and downloads; consider auto-revoking the share.
3. Align `ensure_file_owned_for_share` with active-row checks when creating new shares.

**Verification**

- [ ] Soft-deleted file returns 404 on `public_share_download`.
- [ ] `public_share_all_files` excludes trashed items.
- [ ] Regression test for share + recycle bin interaction.

---

### SEC-004 — Authenticated download/preview ignores soft-delete state

- [ ] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **Category** | Data extraction |
| **Impacted files** | `backend/src/files/handlers.rs` (`download_file`, `download_url`, `preview_url`), `backend/src/hls/handlers.rs` (`ensure_file_owned`, stream/HLS paths) |
| **Routes** | `GET /api/v1/files/{id}/download`, `/download-url`, `/preview-url`, HLS/stream routes |

**Description**

Download and preview handlers query `WHERE id = $1 AND user_id = $2` without requiring `deleted_at IS NULL`. Trashed files remain downloadable by the owning user (and via stream tickets derived from those paths).

**Exploit scenario**

1. User soft-deletes files to recycle bin.
2. Same user (or attacker with stolen session) bulk-downloads trashed files via download URLs or archive jobs before purge.

**Impact**

Weak deletion guarantees; compromised session can extract recycle-bin content at scale.

**Remediation**

1. Add `AND deleted_at IS NULL` to all authenticated file retrieval queries used for download, preview, presigned URL, and HLS ownership checks.
2. Reuse shared constants: `ACTIVE_FILES_SQL` from `backend/src/files/recycle_bin.rs`.

**Verification**

- [ ] `GET /files/{id}/download` on trashed file → 404.
- [ ] `preview-url` and `download-url` behave consistently.

---

### SEC-005 — Unauthenticated setup bootstrap race on fresh deployments

- [ ] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **Category** | Unauthorized action (account takeover) |
| **Impacted files** | `backend/src/setup/handlers.rs` (`setup`, `ensure_not_complete_pool`), `backend/src/lib.rs` |
| **Routes** | `POST /api/v1/setup` |

**Description**

Setup is public until `COUNT(users) > 0`. There is no bootstrap secret, one-time token, or network restriction in application code. Concurrent setup requests can race the empty-user check before the first transaction commits.

**Exploit scenario**

A freshly deployed instance is reachable from the internet before the legitimate operator completes setup. An attacker calls `POST /api/v1/setup` first and becomes the initial admin.

**Impact**

Full instance takeover on mis-exposed or slow-to-configure deployments.

**Remediation**

1. Require a bootstrap secret (env `SETUP_TOKEN` or similar) on all setup mutation routes.
2. Restrict setup to localhost/private network until complete (reverse proxy or bind address).
3. Use an atomic setup lock (advisory lock or dedicated `setup_state` row with compare-and-set).
4. Document deployment checklist: firewall setup before exposing port 443.

**Verification**

- [ ] Setup without valid bootstrap token → 401/403.
- [ ] Concurrent setup attempts: only one succeeds.

---

### SEC-006 — Login/register rate limit trusts spoofable forwarding headers

- [ ] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **Category** | Brute force / account enumeration |
| **Impacted files** | `backend/src/rate_limit.rs` (`client_ip_from_headers`), `backend/src/auth/handlers.rs` (`login`, `register`) |
| **Routes** | `POST /api/v1/auth/login`, `POST /api/v1/auth/register` |

**Description**

Rate limiting keys off `x-forwarded-for` or `x-real-ip` from the request. Clients that reach the API directly (or through a proxy that does not strip client-supplied headers) can rotate keys and bypass per-IP limits.

**Exploit scenario**

Attacker sends many login attempts with a different `X-Forwarded-For` value each time, staying under the per-IP cap while brute-forcing passwords.

**Impact**

Weakened protection against credential stuffing and registration abuse.

**Remediation**

1. Use connection peer IP when not behind a trusted proxy.
2. Only trust `X-Forwarded-For` from known proxy CIDRs (configurable).
3. Add secondary limits: per-email/account lockout or exponential backoff after N failures.
4. Document required nginx/traefik `real_ip` configuration.

**Verification**

- [ ] Direct requests cannot set arbitrary IP for rate limit via headers (when proxy not configured).
- [ ] Brute-force test shows throttling holds under header rotation.

---

## Areas reviewed — no critical issues found

| Area | Result |
|------|--------|
| Admin mutations (`create_user`, `update_user`, `delete_user`, settings, storage nodes) | `require_admin` called on handlers; routes under auth middleware |
| Protected route gating | `/api/v1` admin and user routes wrapped with `auth_middleware` in `lib.rs` |
| JWT validation | Signature + expiry checked; session revocation checked via `user_sessions` |
| Error responses | `AppError` envelope avoids leaking stack traces/SQL in client JSON |
| File list/search IDOR (active library) | Listing scoped by `user_id` and `deleted_at IS NULL` in normal browse paths |
| Bulk/folder download jobs | User-bound job registry and ownership checks before archive access |
| Storage adapter path traversal | Object keys appear DB-derived; no direct filesystem path from user input |
| CSRF on admin mutations | Bearer token in `Authorization` header (not cookie session); classic CSRF less applicable |
| Frontend API bypass | `frontend/src/api/client.ts` attaches JWT; does not weaken server checks |

---

## Assumptions and limits

- **Static review only** — no dynamic scanning, dependency CVE audit, or infrastructure review in this document.
- **Header spoofing (SEC-006)** severity depends on whether the API is exposed directly or only behind a correctly configured reverse proxy.
- **Setup race (SEC-005)** exploitability depends on network exposure during first boot.
- **Nebular OS / object storage** — not fully audited here; focus was API + Postgres access control.
- **Dependency vulnerabilities** — run `cargo audit` and `npm audit` separately.

---

## Suggested verification commands (after fixes)

```bash
# Backend
cd backend && cargo test -p mediavault-backend
cd backend && cargo clippy -p mediavault-backend -- -D warnings

# Frontend
cd frontend && npm run build && npm run lint
```

Add or extend integration tests in `backend/tests/` for:

- Admin demotion invalidates prior token (SEC-002)
- Trashed file blocked on download and public share (SEC-003, SEC-004)
- Setup endpoints blocked or redacted post-setup (SEC-001)

---

## Changelog

| Date | Author | Notes |
|------|--------|-------|
| 2026-06-02 | Security audit (static) | Initial findings documented |
