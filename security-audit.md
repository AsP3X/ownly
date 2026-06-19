# Security Audit — Ownly Stack

**Date:** 2026-06-02  
**Scope:** Static code review of authentication, authorization, setup/bootstrap, file/share access, and admin mutation paths.  
**Method:** Backend route wiring, middleware, SQL access checks, share scope queries, and frontend API client alignment. No live penetration testing was performed.

Use the checkboxes below to track remediation as you work through each item.

---

## Executive summary


This document now covers **two audit rounds**:

- **Round 1 (2026-06-02 → 2026-06-07):** SEC-001 – SEC-012, all remediated.
- **Round 2 (2026-06-10):** SEC-013 – SEC-042, newly discovered; **partially remediated** (see Round 2 findings below).


| Severity | Total | Open | Notes |
| -------- | ----- | ---- | ----- |
| Critical | 1     | 0    | SEC-013 fixed (production profile rejects Compose dev secrets) |
| High     | 12    | 0    | SEC-014 – SEC-020 fixed |
| Medium   | 21    | 9    | SEC-021, SEC-024, SEC-026, SEC-027, SEC-032, SEC-034 (partial), SEC-037–SEC-040 open |
| Low      | 8     | 0    | SEC-035–SEC-042 fixed |


**Round 1 recommended fix order (complete):** SEC-001 → SEC-007 → SEC-002 → SEC-012 → SEC-003 → SEC-008 → SEC-010 → SEC-004 → SEC-011 → SEC-005 → SEC-006 → SEC-009

**Round 2 recommended fix order (open):** SEC-013 → SEC-016 → SEC-015 → SEC-017 → SEC-014 → SEC-018 → SEC-019 → SEC-020 → SEC-027 → SEC-021 → SEC-024 → SEC-025 → (remaining mediums) → (lows)

---

## Findings

### SEC-001 — Public setup endpoints leak database credentials and infrastructure metadata

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                                                                                                            |
| **Category**       | Data extraction / information disclosure                                                                                                                                                        |
| **Impacted files** | `backend/src/setup/handlers.rs` (`setup_database_info`, `setup_storage_info`), `backend/src/lib.rs` (public route wiring)                                                                       |
| **Routes**         | `GET /api/v1/setup/database`, `GET /api/v1/setup/storage`                                                                                                                                       |
| **Audit script**   | [`scripts/security-audit/sec001_setup_info_disclosure.py`](scripts/security-audit/sec001_setup_info_disclosure.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) |


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

**Automated test**

Standalone probe: [`scripts/security-audit/sec001_setup_info_disclosure.py`](scripts/security-audit/sec001_setup_info_disclosure.py). Unauthenticated `GET` of `/setup/database` and `/setup/storage`; flags credential or infrastructure metadata leaks. Full flag list: [`scripts/security-audit/README.md`](scripts/security-audit/README.md) (SEC-001).

| Prerequisite | Detail |
|--------------|--------|
| API | Running Ownly API (default `http://127.0.0.1:8080`) |
| Credentials | None — unauthenticated probe |

```bash
python3 scripts/security-audit/sec001_setup_info_disclosure.py
```

```bash
python3 scripts/security-audit/sec001_setup_info_disclosure.py --base-url http://127.0.0.1:8080 --json --quiet
```

| Exit code | Meaning |
|-----------|---------|
| **0** | No vulnerability indicators (blocked or redacted after setup) |
| **1** | Vulnerable — credentials or storage metadata exposed |
| **2** | Inconclusive — API unreachable |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Unauthenticated `GET /setup/database` returns 404/401 after setup (or redacted body only).
- No password material appears in JSON responses or audit logs.
- `python3 scripts/security-audit/sec001_setup_info_disclosure.py` exits **0** on a fixed deployment (**1** = vulnerable; **2** = inconclusive).

---

### SEC-002 — Stale JWT role allows admin access after demotion

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                                                                                                          |
| **Category**       | Unauthorized action / privilege escalation                                                                                                                                                    |
| **Impacted files** | `backend/src/auth/mod.rs` (`auth_middleware`), `backend/src/admin/handlers.rs` (`require_admin`, `update_user`)                                                                               |
| **Routes**         | All `/api/v1/admin/`* protected routes                                                                                                                                                        |
| **Audit script**   | `[scripts/security-audit/sec002_stale_jwt_admin_role.py](scripts/security-audit/sec002_stale_jwt_admin_role.py)` — see `[scripts/security-audit/README.md](scripts/security-audit/README.md)` (venv setup for contributors) |


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

**Automated test**

Standalone probe: `[scripts/security-audit/sec002_stale_jwt_admin_role.py](scripts/security-audit/sec002_stale_jwt_admin_role.py)`. Full flag list + contributor venv setup: `[scripts/security-audit/README.md](scripts/security-audit/README.md)` (SEC-002).


| Prerequisite | Detail                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------- |
| API          | Running Ownly API (default `http://127.0.0.1:8080`)                                      |
| Setup        | `setup_complete=true` (`GET /api/v1/setup/status`)                                       |
| Admins       | **One** admin with `--bootstrap-subject`, or **two** distinct admins (subject + demoter) |


The script logs in the **subject**, confirms admin access, has the **demoter** `PATCH` the subject to a non-admin role (default `pro`), then reuses the **pre-demotion JWT** on `GET /api/v1/admin/users`. Exit **1** if the stale token still returns the admin user list (HTTP 200); exit **0** if access is denied (401/403).

**Note for contributors:** First run `bash scripts/setup-test-env.sh` (or the `.bat` on Windows) and activate `scripts/.venv` so you have an isolated Python with the right packages. See the top of `scripts/security-audit/README.md`.

**Usage (pick one)**

One admin — creates a temporary `sec002-audit-*@audit.local` subject, then deletes it:

```bash
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --bootstrap-subject --prompt
```

Two admins — interactive:

```bash
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --prompt
```

CLI flags (no `.env`):

```bash
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --bootstrap-subject \
  --demoter-email 'admin@example.com' --demoter-password '...'
```

Gitignored repo `.env` (script loads `SEC002_*` only — see commented block in `[.env.example](.env.example)`):

```bash
SEC002_BOOTSTRAP_SUBJECT=1
SEC002_DEMOTER_EMAIL=your-admin@example.com
SEC002_DEMOTER_PASSWORD=...
SEC002_BASE_URL=http://127.0.0.1:8080
```

Shell variables must be `**export`ed** or placed on the **same line** as `python3` (otherwise the child process does not see them):

```bash
export SEC002_BOOTSTRAP_SUBJECT=1
export SEC002_DEMOTER_EMAIL='admin@example.com'
export SEC002_DEMOTER_PASSWORD='...'
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --bootstrap-subject
```

CI / automation:

```bash
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py \
  --base-url http://127.0.0.1:8080 --bootstrap-subject \
  --demoter-email "$SEC002_DEMOTER_EMAIL" --demoter-password "$SEC002_DEMOTER_PASSWORD" \
  --json --quiet
```

Regression baseline after fix:

```bash
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --save-baseline /tmp/sec002-ok.json
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --compare-baseline /tmp/sec002-ok.json
```


| Exit code | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| **0**     | Not vulnerable — stale JWT denied on admin route after demotion     |
| **1**     | Vulnerable — stale JWT still grants admin API access                |
| **2**     | Inconclusive — missing credentials, API unreachable, or probe error |
| **3**     | `--compare-baseline` mismatch                                       |


Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- After demotion, existing JWT receives 403 on `/api/v1/admin/`* immediately.
- Integration test: demote admin → prior token fails admin routes.
- `python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --bootstrap-subject` (or two-admin mode) exits **0** on a fixed deployment (**1** = vulnerable; **2** = inconclusive).

---

### SEC-003 — Soft-deleted files remain accessible via public share links

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                                                                                                                                                                 |
| **Category**       | Data extraction / unauthorized access                                                                                                                                                                                                                |
| **Impacted files** | `backend/src/shares/store.rs` (`load_file_in_share_scope`, `list_share_folder_files`, `list_all_files_in_share`, `compute_share_tree_stats`, `folder_is_under_root`), `backend/src/shares/handlers.rs` (public share download/list/archive handlers) |
| **Routes**         | `/api/v1/public/shares/{token}/`*                                                                                                                                                                                                                    |
| **Audit script**   | `[scripts/security-audit/sec003_public_share_soft_delete.py](scripts/security-audit/sec003_public_share_soft_delete.py)` — see `[scripts/security-audit/README.md](scripts/security-audit/README.md)` (venv setup for contributors) |


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

**Automated test**

Standalone probe: `[scripts/security-audit/sec003_public_share_soft_delete.py](scripts/security-audit/sec003_public_share_soft_delete.py)`. Full flag list + contributor venv setup: `[scripts/security-audit/README.md](scripts/security-audit/README.md)` (SEC-003).


| Prerequisite | Detail                                                                               |
| ------------ | ------------------------------------------------------------------------------------ |
| API          | Running Ownly API (default `http://127.0.0.1:8080`)                                  |
| Setup        | `setup_complete=true`                                                                |
| Owner        | One drive account with permission to create folders, upload, share, and delete files |
| Scenario     | **Folder** public share (nested file deleted; share link stays active)               |


The script logs in as the **owner**, prepares a folder share and probe file (bootstrap: find folder with file, or create `sec003-audit-`* folder + upload `sec003-probe.txt`), confirms the file appears on `GET /api/v1/public/shares/{token}/all-files`, soft-deletes the file, then probes **without** the owner JWT:

- `GET /public/shares/{token}/all-files` — must not list the trashed `file_id` (exit **1** if still listed).
- `GET /public/shares/{token}/files/{file_id}/download` — must not return file bytes (exit **1** if HTTP 200 attachment).

By default the probe file is **restored** from the recycle bin after the run (`--no-restore` to skip).

**Usage**

```bash
python3 scripts/security-audit/sec003_public_share_soft_delete.py --prompt
```

```bash
export SEC003_OWNER_EMAIL='owner@example.com'
export SEC003_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec003_public_share_soft_delete.py
```

```bash
python3 scripts/security-audit/sec003_public_share_soft_delete.py \
  --owner-email 'owner@example.com' --owner-password '...'
```

Password-protected share links:

```bash
python3 scripts/security-audit/sec003_public_share_soft_delete.py \
  --share-password 'link-password' --owner-email '...' --owner-password '...'
```

CI / automation:

```bash
python3 scripts/security-audit/sec003_public_share_soft_delete.py --json --quiet \
  --owner-email "$SEC003_OWNER_EMAIL" --owner-password "$SEC003_OWNER_PASSWORD"
```


| Exit code | Meaning                                                                    |
| --------- | -------------------------------------------------------------------------- |
| **0**     | Not vulnerable — trashed file absent from all-files and download denied    |
| **1**     | Vulnerable — trashed file still listed and/or downloadable                 |
| **2**     | Inconclusive — missing credentials, API/storage error, or bootstrap failed |
| **3**     | `--compare-baseline` mismatch                                              |


Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Soft-deleted file returns 404 on `public_share_download`.
- `public_share_all_files` excludes trashed items.
- Regression test for share + recycle bin interaction.
- `python3 scripts/security-audit/sec003_public_share_soft_delete.py` exits **0** on a fixed deployment (**1** = vulnerable; **2** = inconclusive).

---

### SEC-004 — Authenticated download/preview ignores soft-delete state

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                                                                                                                        |
| **Category**       | Data extraction                                                                                                                                                                                               |
| **Impacted files** | `backend/src/files/handlers.rs` (`download_file`, `download_url`, `preview_url`), `backend/src/hls/handlers.rs` (`ensure_file_owned`, stream/HLS paths)                                                       |
| **Routes**         | `GET /api/v1/files/{id}/download`, `/download-url`, `/preview-url`, HLS/stream routes                                                                                                                         |
| **Audit script**   | `[scripts/security-audit/sec004_authenticated_trash_download.py](scripts/security-audit/sec004_authenticated_trash_download.py)` — see `[scripts/security-audit/README.md](scripts/security-audit/README.md)` (venv setup for contributors) |


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

**Automated test**

Standalone probe: `[scripts/security-audit/sec004_authenticated_trash_download.py](scripts/security-audit/sec004_authenticated_trash_download.py)`. Full flag list + contributor venv setup: `[scripts/security-audit/README.md](scripts/security-audit/README.md)` (SEC-004).


| Prerequisite | Detail                                                  |
| ------------ | ------------------------------------------------------- |
| API          | Running Ownly API (default `http://127.0.0.1:8080`)     |
| Setup        | `setup_complete=true`                                   |
| Owner        | One account that can upload, delete, and download files |


The script logs in, prepares a probe file (bootstrap upload or `SEC004_FILE_ID`), confirms `download`, `download-url`, and `preview-url` work **before** trash, soft-deletes the file, then re-probes with the **same owner JWT**. Exit **1** if any route still grants access after trash.

```bash
python3 scripts/security-audit/sec004_authenticated_trash_download.py --prompt
```

```bash
export SEC004_OWNER_EMAIL='owner@example.com'
export SEC004_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec004_authenticated_trash_download.py
```


| Exit code | Meaning                                                           |
| --------- | ----------------------------------------------------------------- |
| **0**     | Not vulnerable — trashed file blocked on all three routes         |
| **1**     | Vulnerable — download and/or URL endpoints still work after trash |
| **2**     | Inconclusive — credentials, API, or bootstrap failure             |
| **3**     | `--compare-baseline` mismatch                                     |


Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- `GET /files/{id}/download` on trashed file → 404.
- `preview-url` and `download-url` behave consistently.
- `python3 scripts/security-audit/sec004_authenticated_trash_download.py` exits **0** on a fixed deployment (**1** = vulnerable; **2** = inconclusive).

---

### SEC-005 — Unauthenticated setup bootstrap race on fresh deployments

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                                                                                                        |
| **Category**       | Unauthorized action (account takeover)                                                                                                                                                        |
| **Impacted files** | `backend/src/setup/handlers.rs` (`setup`, `ensure_not_complete_pool`), `backend/src/lib.rs`                                                                                                   |
| **Routes**         | `POST /api/v1/setup`                                                                                                                                                                          |
| **Audit script**   | `[scripts/security-audit/sec005_setup_bootstrap_race.py](scripts/security-audit/sec005_setup_bootstrap_race.py)` — see `[scripts/security-audit/README.md](scripts/security-audit/README.md)` (venv setup for contributors) |


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

**Automated test**

Standalone probe: `[scripts/security-audit/sec005_setup_bootstrap_race.py](scripts/security-audit/sec005_setup_bootstrap_race.py)`. Uses an intentionally invalid setup body (password too short) so it does **not** create an admin on initialized instances.


| Prerequisite | Detail                                              |
| ------------ | --------------------------------------------------- |
| API          | Running Ownly API (default `http://127.0.0.1:8080`) |
| Credentials  | None — unauthenticated probe                        |


```bash
python3 scripts/security-audit/sec005_setup_bootstrap_race.py
```


| Exit code | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| **0**     | Bootstrap secret enforced (401/403 without valid token)   |
| **1**     | Vulnerable — POST /setup processed without bootstrap auth |
| **2**     | Inconclusive — API unreachable or unexpected errors       |
| **3**     | `--compare-baseline` mismatch                             |


On **pre-setup** instances (`setup_complete=false`), exit **1** confirms public setup mutation. On **post-setup** instances, exit **1** indicates missing bootstrap-token gate (409 without token check). Concurrent race requires manual testing on a fresh database.

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Setup without valid bootstrap token → 401/403.
- Concurrent setup attempts: only one succeeds.
- `python3 scripts/security-audit/sec005_setup_bootstrap_race.py` exits **0** after remediation (**1** = vulnerable).

---

### SEC-006 — Login/register rate limit trusts spoofable forwarding headers

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Severity**       | Medium                                                                                                       |
| **Category**       | Brute force / account enumeration                                                                            |
| **Impacted files** | `backend/src/rate_limit.rs` (`client_ip_from_headers`), `backend/src/auth/handlers.rs` (`login`, `register`) |
| **Routes**         | `POST /api/v1/auth/login`, `POST /api/v1/auth/register`                                                      |
| **Audit script**   | [`scripts/security-audit/sec006_rate_limit_forwarded_headers.py`](scripts/security-audit/sec006_rate_limit_forwarded_headers.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) (venv setup for contributors) |


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

**Automated test**

Standalone probe: [`scripts/security-audit/sec006_rate_limit_forwarded_headers.py`](scripts/security-audit/sec006_rate_limit_forwarded_headers.py). Bursts failed `POST /auth/login` (and optionally `POST /auth/register`) with fixed vs rotated `X-Forwarded-For` / `X-Real-IP`.

| Prerequisite | Detail |
|--------------|--------|
| API | Running Ownly API (default `http://127.0.0.1:8080`) |
| Setup | `setup_complete=true` |
| Credentials | None |

```bash
python3 scripts/security-audit/sec006_rate_limit_forwarded_headers.py
```

If your deployment overrides `AUTH_LOGIN_RPM` / `AUTH_REGISTER_RPM`, pass matching values: `--login-rpm 15 --register-rpm 5`.

| Exit code | Meaning |
|-----------|---------|
| **0** | Rotation does not bypass throttling (fixed and rotated bursts both hit 429) |
| **1** | Vulnerable — header rotation avoids rate limits that apply to a fixed spoofed IP |
| **2** | Inconclusive — API unreachable or fixed-IP burst never throttled |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Direct requests cannot set arbitrary IP for rate limit via headers (when proxy not configured).
- Brute-force test shows throttling holds under header rotation.
- `python3 scripts/security-audit/sec006_rate_limit_forwarded_headers.py` exits **0** after remediation (**1** = vulnerable).

---

### SEC-007 — Password-protected share overview bypass exposes metadata without password

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| **Severity**       | High                                                                               |
| **Category**       | Data extraction / unauthorized access                                              |
| **Impacted files** | `backend/src/shares/handlers.rs` (`public_share_overview`, `resolve_public_share`) |
| **Routes**         | `GET /api/v1/public/shares/{token}`                                                |
| **Audit script**   | [`scripts/security-audit/sec007_share_overview_password_bypass.py`](scripts/security-audit/sec007_share_overview_password_bypass.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) (venv setup for contributors) |


**Description**

`public_share_overview` resolves active share tokens but does not enforce share-password verification. Other public share endpoints call `resolve_public_share`, which validates `x-share-password`, but the overview route bypasses that path.

**Evidence**

```rust
// public_share_overview — no password verification
let share = resolve_active_share(&state.pool, &token).await?;

// resolve_public_share — does verify password
verify_share_password(&share, share_password_header(headers).as_deref())?;
```

**Exploit scenario**

1. Owner creates a password-protected public share.
2. Attacker obtains the token (logs, referrer leak, screenshot, clipboard history, etc.).
3. Attacker calls overview endpoint and retrieves resource metadata (including `shared_by_email`, names, sizes, counts) without the password.

**Impact**

Intended protection boundary is broken for share metadata; unauthenticated parties can extract user/content details that should require the share password.

**Remediation**

1. Route `public_share_overview` through `resolve_public_share` (with headers), or perform equivalent password check.
2. Add integration tests for password-protected shares covering **all** public endpoints, including overview.
3. Consider minimizing overview payload sensitivity (e.g., hide owner email) when password-protected.

**Automated test**

Standalone probe: [`scripts/security-audit/sec007_share_overview_password_bypass.py`](scripts/security-audit/sec007_share_overview_password_bypass.py). Bootstraps a password-protected folder share (or uses `SEC007_SHARE_*`), then probes overview without `x-share-password`.

| Prerequisite | Detail |
|--------------|--------|
| API | Running Ownly API (default `http://127.0.0.1:8080`) |
| Setup | `setup_complete=true` |
| Owner | Account that can create shares and set a share password |

```bash
python3 scripts/security-audit/sec007_share_overview_password_bypass.py --prompt
```

```bash
export SEC007_OWNER_EMAIL='owner@example.com'
export SEC007_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec007_share_overview_password_bypass.py
```

| Exit code | Meaning |
|-----------|---------|
| **0** | Not vulnerable — overview denied without password |
| **1** | Vulnerable — overview exposes metadata without `x-share-password` |
| **2** | Inconclusive — credentials, API, or bootstrap failure |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- `GET /public/shares/{token}` on password-protected share returns 403 without correct `x-share-password`.
- With correct password header, overview response remains functional.
- `python3 scripts/security-audit/sec007_share_overview_password_bypass.py` exits **0** after remediation (**1** = vulnerable).

---

### SEC-008 — Setup storage probe allows unauthenticated SSRF/internal network reconnaissance

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                                                    |
| **Category**       | Data extraction / infrastructure reconnaissance                                                                                           |
| **Impacted files** | `backend/src/setup/handlers.rs` (`test_setup_storage`), `backend/src/admin/storage_nodes.rs` (`normalize_base_url`, `probe_storage_node`) |
| **Routes**         | `POST /api/v1/setup/storage/test`                                                                                                         |
| **Audit script**   | [`scripts/security-audit/sec008_setup_storage_ssrf.py`](scripts/security-audit/sec008_setup_storage_ssrf.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) (venv setup for contributors) |


**Description**

Before setup completes, unauthenticated callers can submit arbitrary `base_url` values. The API then performs outbound requests to `{base_url}/health` and `{base_url}/metrics`. URL validation only checks scheme (`http`/`https`), so internal targets (RFC1918, localhost, link-local, metadata services) are not blocked.

**Evidence**

```rust
let base_url = storage_nodes::normalize_base_url(&body.base_url)?;
let probe = storage_nodes::probe_storage_endpoint(&base_url).await;
```

```rust
if !url.starts_with("http://") && !url.starts_with("https://") { ... }
```

```rust
let health_url = format!("{}/health", base_url.trim_end_matches('/'));
let metrics_url = format!("{}/metrics", base_url.trim_end_matches('/'));
```

**Exploit scenario**

During bootstrap window, an external attacker repeatedly calls setup storage test with internal hostnames/IPs to map reachable services and infer network topology via timing/status behavior.

**Impact**

SSRF-style network probing from trusted server context, which can expose internal infrastructure and aid follow-on attacks.

**Remediation**

1. Require bootstrap secret/auth for setup test endpoints.
2. Add outbound target validation: block localhost, private/link-local ranges, and cloud metadata endpoints by default.
3. Optional: enforce allowlist of approved storage hostnames/CIDRs during setup.
4. Add strict request timeout and response size caps (if not already enforced globally).

**Automated test**

Standalone probe: [`scripts/security-audit/sec008_setup_storage_ssrf.py`](scripts/security-audit/sec008_setup_storage_ssrf.py). Posts internal `base_url` values to `POST /setup/storage/test` without credentials.

| Prerequisite | Detail |
|--------------|--------|
| API | Running Ownly API (default `http://127.0.0.1:8080`) |
| Pre-setup | **Full SSRF check** needs `setup_complete=false` (fresh DB or uninitialized instance) |
| Credentials | None |

```bash
python3 scripts/security-audit/sec008_setup_storage_ssrf.py
```

On initialized instances the script still checks post-setup gating (expects **409**). Use `--require-pre-setup` to require a fresh instance.

| Exit code | Meaning |
|-----------|---------|
| **0** | Internal targets rejected or endpoint auth-gated |
| **1** | Vulnerable — unauthenticated probe accepts internal URLs |
| **2** | Inconclusive — API unreachable or `--require-pre-setup` on completed setup |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Requests targeting `127.0.0.1`, `169.254.169.254`, and private RFC1918 ranges are rejected.
- Legitimate storage endpoints still pass probe checks.
- `python3 scripts/security-audit/sec008_setup_storage_ssrf.py` exits **0** after remediation on a **pre-setup** deployment (**1** = vulnerable).

---

### SEC-009 — Public share password checks lack brute-force throttling

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                                              |
| **Category**       | Unauthorized access / brute force                                                                                                   |
| **Impacted files** | `backend/src/shares/store.rs` (`verify_share_password`), `backend/src/shares/handlers.rs` (public share routes using password gate) |
| **Routes**         | `/api/v1/public/shares/{token}`* on password-protected links                                                                        |
| **Audit script**   | [`scripts/security-audit/sec009_share_password_bruteforce.py`](scripts/security-audit/sec009_share_password_bruteforce.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) |


**Description**

Share password verification exists, but there is no dedicated per-token/IP attempt throttling, lockout, or exponential backoff for failed password attempts on public share routes.

**Evidence**

```rust
if !verify_password(password, stored_hash).unwrap_or(false) {
    return Err(AppError::Forbidden("incorrect share password".into()));
}
```

No adjacent rate-limit call is applied in this password check flow.

**Exploit scenario**

If a share token leaks, attacker scripts repeated requests with guessed `x-share-password` values until one succeeds.

**Impact**

Password-protected shares are vulnerable to online guessing, potentially enabling unauthorized viewing/downloading of shared user content.

**Remediation**

1. Add rate limiting keyed by `{share_token, source_ip}` for failed password attempts.
2. Consider temporary lockout/backoff after N failures.
3. Log and audit repeated failures for detection.
4. Consider configurable minimum/complexity policy for share passwords.

**Automated test**

Standalone probe: [`scripts/security-audit/sec009_share_password_bruteforce.py`](scripts/security-audit/sec009_share_password_bruteforce.py). Bootstraps a password-protected folder share, then bursts wrong `x-share-password` values on `GET /public/shares/{token}/contents`.

| Prerequisite | Detail |
|--------------|--------|
| API | Running Ownly API (default `http://127.0.0.1:8080`) |
| Setup | `setup_complete=true` |
| Owner | Account that can create shares and set a share password |

```bash
python3 scripts/security-audit/sec009_share_password_bruteforce.py --prompt
```

```bash
export SEC009_OWNER_EMAIL='owner@example.com'
export SEC009_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec009_share_password_bruteforce.py
```

| Exit code | Meaning |
|-----------|---------|
| **0** | Throttling observed (HTTP 429) on wrong-password burst |
| **1** | Vulnerable — many wrong guesses return 403 without rate limit |
| **2** | Inconclusive — credentials, API, or bootstrap failure |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Repeated wrong-password attempts trigger 429 and/or lockout behavior.
- Correct password succeeds after cooldown/within configured policy.
- `python3 scripts/security-audit/sec009_share_password_bruteforce.py` exits **0** after remediation (**1** = vulnerable).

---

### SEC-010 — Setup database test allows unauthenticated internal Postgres probing

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                        |
| **Category**       | Data extraction / infrastructure reconnaissance                                                               |
| **Impacted files** | `backend/src/setup/handlers.rs` (`test_setup_database`), `backend/src/db.rs` (`test_connection`, `init_pool`) |
| **Routes**         | `POST /api/v1/setup/database/test`                                                                            |
| **Audit script**   | [`scripts/security-audit/sec010_setup_database_ssrf.py`](scripts/security-audit/sec010_setup_database_ssrf.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) |


**Description**

Before setup completes, unauthenticated callers can submit arbitrary `database_url` values. The API attempts a real Postgres connection (and may create the database and run migrations via `init_pool`). There is no bootstrap secret and no blocklist for internal/private host targets.

**Evidence**

```rust
// test_setup_database — public pre-setup
db::test_connection(url).await

// test_connection — opens pool against caller-supplied URL
let pool = init_pool(database_url).await?;
sqlx::query("SELECT 1").execute(&pool).await?;
```

**Exploit scenario**

During the bootstrap window, an attacker probes `postgres://user:pass@127.0.0.1:5432/...`, RFC1918 hosts, or cloud metadata-adjacent services to map reachable databases and infer network layout from success/failure timing.

**Impact**

SSRF-style database probing from the API host; may aid credential stuffing against misconfigured internal Postgres or lateral movement planning.

**Remediation**

1. Require bootstrap secret/auth on all setup test routes (same as SEC-005 recommendation).
2. Reject connection targets that resolve to localhost, link-local, or private IP ranges unless explicitly allowed for dev.
3. Prefer a lightweight TCP/TLS handshake check over full `init_pool` + migrations for wizard “test connection” UX.
4. Rate-limit setup test endpoints per source IP.

**Automated test**

Standalone probe: [`scripts/security-audit/sec010_setup_database_ssrf.py`](scripts/security-audit/sec010_setup_database_ssrf.py). Posts internal `database_url` values to `POST /setup/database/test` without credentials.

| Prerequisite | Detail |
|--------------|--------|
| API | Running Ownly API (default `http://127.0.0.1:8080`) |
| Pre-setup | **Full DB probe check** needs `setup_complete=false` (fresh DB or uninitialized instance) |
| Credentials | None |

```bash
python3 scripts/security-audit/sec010_setup_database_ssrf.py
```

On initialized instances the script still checks post-setup gating (expects **409**). Use `--require-pre-setup` to require a fresh instance.

| Exit code | Meaning |
|-----------|---------|
| **0** | Internal targets rejected or endpoint auth-gated |
| **1** | Vulnerable — unauthenticated probe accepts internal Postgres URLs |
| **2** | Inconclusive — API unreachable or `--require-pre-setup` on completed setup |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Unauthenticated setup DB test without valid bootstrap token → 401/403 (when token enforced).
- URLs targeting `127.0.0.1` and private ranges are rejected before outbound connect.
- `python3 scripts/security-audit/sec010_setup_database_ssrf.py` exits **0** after remediation on a **pre-setup** deployment (**1** = vulnerable).

---

### SEC-011 — Folder and bulk zip archives include soft-deleted (recycle-bin) files

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                                                         |
| **Category**       | Data extraction                                                                                                                                |
| **Impacted files** | `backend/src/files/folder_download.rs` (`collect_zip_entries_for_folder`), `backend/src/files/zip_job.rs` (`collect_zip_entries_for_file_ids`) |
| **Routes**         | `POST /api/v1/folders/{id}/download`, `POST /api/v1/files/download`                                                                            |
| **Audit script**   | [`scripts/security-audit/sec011_trash_zip_download.py`](scripts/security-audit/sec011_trash_zip_download.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) |


**Description**

Zip archive builders query files by `user_id` (and folder membership or explicit ids) but omit `deleted_at IS NULL`. Trashed files remain packable into folder and bulk download archives for the owning user.

**Evidence**

```sql
-- collect_zip_entries_for_folder
FROM files WHERE user_id = $1 AND folder_id = $2

-- collect_zip_entries_for_file_ids
FROM files WHERE id = $1 AND user_id = $2
-- (no deleted_at IS NULL in either)
```

**Exploit scenario**

1. User soft-deletes sensitive files to recycle bin believing they are inaccessible for normal download.
2. Same user (or attacker with stolen session) starts folder zip or bulk download including those file ids or parent folder.
3. Archive completes with trashed content still extractable.

**Impact**

Weak deletion guarantees on archive paths; overlaps SEC-004 theme but affects multi-file zip flows not covered by single-file download handlers alone.

**Remediation**

1. Add `AND deleted_at IS NULL` (or `ACTIVE_FILES_SQL` from `files/recycle_bin.rs`) to all zip entry collection queries.
2. Reject bulk download requests where any `file_id` refers to a trashed row.
3. When walking folder trees for zip, skip trashed subfolders/files consistently with browse listing.

**Automated test**

Standalone probe: [`scripts/security-audit/sec011_trash_zip_download.py`](scripts/security-audit/sec011_trash_zip_download.py). Bootstraps a folder + probe file, confirms bulk and folder zip jobs start before trash, soft-deletes the file, then re-probes with the **same owner JWT**.

| Prerequisite | Detail |
|--------------|--------|
| API | Running Ownly API (default `http://127.0.0.1:8080`) |
| Setup | `setup_complete=true` |
| Owner | One account that can upload, delete, and start zip downloads |

```bash
python3 scripts/security-audit/sec011_trash_zip_download.py --prompt
```

```bash
export SEC011_OWNER_EMAIL='owner@example.com'
export SEC011_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec011_trash_zip_download.py
```

| Exit code | Meaning |
|-----------|---------|
| **0** | Not vulnerable — trashed file blocked on bulk and/or folder zip |
| **1** | Vulnerable — zip job still starts after trash |
| **2** | Inconclusive — credentials, API, or bootstrap failure |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Folder zip of a tree with trashed files excludes trashed members.
- Bulk download with a trashed `file_id` → 400/404.
- Regression test aligned with SEC-003/SEC-004 recycle-bin behavior.
- `python3 scripts/security-audit/sec011_trash_zip_download.py` exits **0** on a fixed deployment (**1** = vulnerable; **2** = inconclusive).

---

### SEC-012 — Live exploit: unauthenticated first-admin creation (setup hijack)

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                                                                                                            |
| **Category**       | Unauthorized action / privilege escalation / account takeover                                                                                                                                   |
| **Related**        | SEC-005 (probe only), SEC-002 (JWT role trust)                                                                                                                                                  |
| **Impacted files** | `backend/src/setup/handlers.rs` (`setup`, `ensure_not_complete_pool`), `backend/src/auth/mod.rs`, `backend/src/admin/handlers.rs` (`require_admin`)                                            |
| **Routes**         | `POST /api/v1/setup`, `POST /api/v1/auth/login`, `GET /api/v1/admin/users`                                                                                                                      |
| **Audit script**   | [`scripts/security-audit/sec012_unauthenticated_admin_creation.py`](scripts/security-audit/sec012_unauthenticated_admin_creation.py) — see [`scripts/security-audit/README.md`](scripts/security-audit/README.md) |


**Description**

Unlike SEC-005 (invalid probe body only), **SEC-012** runs a **live exploit** when `--confirm-exploit` is set.

**Chain A (fresh DB):** `POST /setup` creates the first `role=admin` user.

**Chain B (initialized instance — default for existing databases):** Log in as any non-admin (credentials via `--exploit-email` / `--prompt`), load `JWT_SECRET` from repo `.env`, re-sign the session JWT with `role=admin`, confirm `GET /admin/users`, then `POST /admin/users` to insert a **new** administrator row and log in as that account (same JWT trust gap as SEC-002).

**Exploit scenario (Chain A)**

1. Fresh deployment is reachable before the operator completes setup (see SEC-005).
2. Attacker runs the SEC-012 script with `--confirm-exploit`.
3. Attacker becomes the instance administrator; can create users, change settings, and access all user data via admin APIs.

**Impact**

Full instance takeover on mis-exposed or slow-to-configure deployments.

**Remediation**

Same as SEC-005 plus SEC-002: bootstrap secret on setup, network restriction until complete, reload `role` from DB in `auth_middleware`, strong non-default `JWT_SECRET`.

**Automated test (destructive on fresh DB)**

```bash
# Requires setup_complete=false and object storage reachable (Compose stack up).
export SEC012_CONFIRM_EXPLOIT=1
python3 scripts/security-audit/sec012_unauthenticated_admin_creation.py --base-url http://127.0.0.1:8080
```

| Prerequisite | Detail |
|--------------|--------|
| API | Running; `GET /api/v1/setup/status` → `setup_complete: false` for Chain A |
| Confirm | `--confirm-exploit` or `SEC012_CONFIRM_EXPLOIT=1` (refuses live exploit otherwise) |
| Storage | Nebular `/health` reachable unless API runs with relaxed setup probe (tests only) |

| Exit code | Meaning |
|-----------|---------|
| **0** | Exploit blocked (bootstrap token, or post-setup with forgery rejected) |
| **1** | **Vulnerable** — administrator created via setup and/or forged JWT reached admin API |
| **2** | Inconclusive — no `--confirm-exploit`, API unreachable, or setup POST failed (storage down) |
| **3** | `--compare-baseline` mismatch |

Unit tests (no live API): `python3 -m unittest discover -s scripts/security-audit/tests -v`

**Verification**

- Fresh instance: script with `--confirm-exploit` exits **1** before fix; **0** after bootstrap token required.
- Initialized instance: second `POST /setup` returns 409; optional JWT forgery exits **0** after role reload from DB.

---

# Round 2 findings (2026-06-10)

**Scope:** Full-repository static review — backend (Rust/Axum), frontend (Vite/React), Docker/Compose, CI, scripts, and migrations. High and Critical items were manually verified against source. No live penetration testing.

> All Round 2 findings below are **open** unless explicitly marked otherwise.

---

### SEC-013 — Committed Compose dev secrets pass production startup validation

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Critical (deployment-conditional: only when the running instance uses Compose defaults)                                                             |
| **Category**       | Authentication bypass / credential disclosure                                                                                                       |
| **Impacted files** | `backend/src/secrets.rs` (`is_weak_secret`, `validate_startup_secrets`), `backend/src/config.rs` (`COMPOSE_DEV_*` constants), `docker-compose.yml`  |
| **Routes**         | All — forged JWTs and stream tickets affect every authenticated/ticketed route                                                                      |

**Description**

`validate_startup_secrets` rejects empty values, `GENERATE_ME`, and a short `KNOWN_WEAK_SECRETS` list, plus enforces a 32-char minimum. The publicly committed Compose literals (`ownly-compose-local-dev-jwt-secret-...`, setup token, signing secret) are **not** in that list and are **deliberately accepted** — `secrets.rs` includes a passing test `compose_dev_setup_token_is_acceptable`. `OWNLY_ENVIRONMENT` is never consulted during validation, so `production` does not tighten the policy.

**Evidence**

```rust
// backend/src/secrets.rs
const KNOWN_WEAK_SECRETS: &[&str] = &[ "change-me-in-production", /* ... */ "ownly-master-key" ];
// COMPOSE_DEV_* constants are absent here and explicitly asserted acceptable in tests.
```

**Exploit scenario**

An operator runs `docker compose up` on an internet-reachable host without rotating secrets. An attacker reads `JWT_SECRET` / `SIGNING_SECRET` from the public repo, forges a JWT with `role: admin` (or signs stream tickets / completes setup with the known `SETUP_TOKEN`), and takes over the instance and all data.

**Impact**

Full account/admin impersonation and data compromise on any deployment left on Compose defaults.

**Remediation**

1. Add the `COMPOSE_DEV_*` constants to a denylist that is **rejected when `OWNLY_ENVIRONMENT=production`**.
2. Make `OWNLY_ENVIRONMENT=production` enforce a hardened profile (reject dev secrets, require explicit CORS origins, disable private outbound).
3. Remove the test that asserts the compose token is acceptable, or scope it to development only.

**Verification**

- API refuses to start with any `COMPOSE_DEV_*` secret when `OWNLY_ENVIRONMENT=production`.
- Startup succeeds with operator-generated `openssl rand -hex 32` secrets.

---

### SEC-014 — Storage quota is never enforced on write paths

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                                             |
| **Category**       | Resource exhaustion / quota bypass                                                                                              |
| **Impacted files** | `backend/src/files/handlers.rs` (`upload_file`, `copy_file`), `backend/src/shares/handlers.rs` (`save_from_public_share`), `backend/src/quota.rs` |
| **Routes**         | `POST /api/v1/files/upload`, file copy, save-from-share                                                                          |

**Description**

`crate::quota::resolve_user_quota_bytes` is only called from two **display-only** endpoints (the `/me` profile and the drive dashboard). No write path checks usage against quota before inserting files. The upload handler's comment claims "Reject over quota" but the code only calls the rate limiter.

**Evidence**

```rust
// backend/src/files/handlers.rs — upload_file
// Human: Reject over quota but still drain the multipart body so the client gets a clean 429.
if let Err(e) = rate_limit::enforce(&state.upload_rl, &claims.sub) {
    drain_multipart(&mut multipart).await;
    return Err(e);
}
```

`rg resolve_user_quota_bytes` returns only `auth/handlers.rs` (profile) and `files/handlers.rs:1573` (dashboard) — never an enforcement path.

**Exploit scenario**

Any authenticated user uploads or copies files (incl. bulk save-from-share, up to 200 files) past their `storage_quota_gb` until the disk fills, regardless of the quota shown in the UI.

**Impact**

Per-user and global storage exhaustion → denial of service for the whole instance.

**Remediation**

Before each storage write, atomically check `used_bytes + incoming_size <= quota_bytes` (transaction / `SELECT ... FOR UPDATE`) and reject with `413`/`400`. Apply to upload, copy, save-from-share, and the video-ingest reservation path.

**Automated test**

Integration: `copy_file_rejected_when_quota_exceeded` in `backend/tests/http_integration.rs` (SEC-014).

**Verification**

- Upload that would exceed quota is rejected; usage never exceeds `storage_quota_gb`.
- Integration test covering copy against a small quota.

---

### SEC-015 — "Leave share" leaves the underlying permission grant intact

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Severity**       | High                                                                                                        |
| **Category**       | Broken access control / stale ACL                                                                           |
| **Impacted files** | `backend/src/shares/handlers.rs` (`leave_shared_with_me` vs `revoke_user_share`), `backend/src/authz/grants.rs` (`revoke_content_read_for_user_share`) |
| **Routes**         | `DELETE /api/v1/shares/with-me/{id}`                                                                          |

**Description**

`revoke_user_share` correctly deletes the invite **and** calls `revoke_content_read_for_user_share`. `leave_shared_with_me` only deletes the `resource_user_shares` row; it never revokes the `permission_grants` row created at invite time.

**Evidence**

```rust
// backend/src/shares/handlers.rs — leave_shared_with_me
let result = sqlx::query(
    "DELETE FROM resource_user_shares WHERE id = $1 AND grantee_user_id = $2",
)
// no revoke_content_read_for_user_share(...) call follows
```

**Exploit scenario**

A grantee calls `DELETE /shares/with-me/{id}`. The invite disappears from "shared with me", but the `content.read` (or higher) grant remains, so `authz::authorize()` still permits `GET /files/{id}/download` and other content access.

**Impact**

Users who "leave" a share retain full read/download access to the resource indefinitely.

**Remediation**

In `leave_shared_with_me`, `RETURNING resource_type, resource_id, grantee_user_id` and call `revoke_content_read_for_user_share` (matching `revoke_user_share`).

**Verification**

- After leaving a share, `GET /files/{id}/download` returns 403/404.
- Integration test: invite → leave → download denied.

---

### SEC-016 — Privilege escalation: `instance.admin` is grantable via the permissions API

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                           |
| **Category**       | Privilege escalation                                                                                          |
| **Impacted files** | `backend/src/authz/grants.rs` (`upsert_grant`, `ensure_can_manage_grants`), `backend/src/authz/catalog.rs` (`Permission::parse`, `satisfies`) |
| **Routes**         | `PUT /api/v1/admin/permissions`                                                                                 |

**Description**

The admin UI picker (`instance_assignable()`) intentionally excludes `InstanceAdmin`, but `upsert_grant` accepts **any** value `Permission::parse` recognizes — including `"instance.admin"`. The only gate is `ensure_can_manage_grants`, satisfied by `InstancePermissionsManage`. Because `satisfies()` makes `InstanceAdmin` supersede every instance permission, a holder of `instance.permissions.manage` can grant themselves full admin.

**Evidence**

```rust
// backend/src/authz/catalog.rs
pub fn parse(value: &str) -> Result<Self, AppError> {
    match value.trim() {
        "instance.admin" => Ok(Self::InstanceAdmin),
        // ...
```

**Exploit scenario**

A user with only `instance.permissions.manage` calls `PUT /api/v1/admin/permissions` with `{ "permission": "instance.admin", "subject_type": "user", "subject_id": "<self>", "resource_type": "instance", "effect": "allow" }`. Subsequent admin calls pass `authorize_instance()` for any permission.

**Impact**

Escalation from a delegated permission-manager role to full instance administrator.

**Remediation**

Reject `instance.admin` in `upsert_grant` (admin must come from admin-group membership only). Optionally require `InstanceAdmin` to grant any instance-scoped permission, and bump the session epoch when instance grants change.

**Verification**

- `PUT /admin/permissions` with `permission=instance.admin` returns 400/403.
- Integration test: `instance.permissions.manage` holder cannot self-grant admin.

---

### SEC-017 — Self-service password change does not revoke existing sessions

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                 |
| **Category**       | Session management                                                                                  |
| **Impacted files** | `backend/src/auth/handlers.rs` (`change_password`), `backend/src/user_sessions.rs` (`bump_session_epoch`) |
| **Routes**         | `POST /api/v1/auth/password` (change password)                                                        |

**Description**

Admin password reset bumps the session epoch (SEC-002 fix), but the user's own `change_password` updates the hash and writes audit without calling `bump_session_epoch` or revoking the current `sid`. Existing JWTs stay valid until expiry.

**Evidence**

```rust
// backend/src/auth/handlers.rs — change_password
sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
    // ... no bump_session_epoch call
```

**Exploit scenario**

An attacker holding a stolen JWT keeps access after the victim changes their password to "lock them out". The token works until the JWT TTL (up to 24h) expires.

**Impact**

Password change provides a false sense of revocation; stolen tokens survive.

**Remediation**

On successful `change_password`, call `bump_session_epoch` (invalidate all sessions) or revoke other sessions and re-issue a token for the current session.

**Verification**

- After password change, a previously issued token returns 401.
- Integration test mirroring the admin-reset epoch-bump test.

---

### SEC-018 — Ticket-gated media routes ignore `deleted_at` and do not bind the ticket user

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                                   |
| **Category**       | Broken access control / soft-delete bypass                                                                            |
| **Impacted files** | `backend/src/hls/handlers.rs` (`ensure_file_playback`, `stream_file`), `backend/src/files/gif_preview.rs`, `backend/src/stream_ticket.rs` (`validate_ticket`) |
| **Routes**         | `GET /api/v1/files/{id}/stream`, `GET /api/v1/hls/*`, preview-animation                                                  |

**Description**

`ensure_file_playback`, `stream_file`, and the GIF-preview route look up files by id only — no `deleted_at IS NULL`, no ownership/ACL re-check. `validate_ticket` verifies `file_id`, HMAC, and expiry but discards the `user_id` embedded in the ticket. HLS playback tickets have a 4-hour TTL.

**Evidence**

```rust
// backend/src/hls/handlers.rs — ensure_file_playback
let row: Option<HlsPlaybackRow> = sqlx::query_as(
    "SELECT storage_key, hls_ready, segment_count, size_bytes FROM files WHERE id = $1",
).bind(file_id)  // no deleted_at, no user_id
```

**Exploit scenario**

A user obtains a stream/HLS ticket, then the file is trashed or access revoked. Until the ticket expires (up to 4h), the holder — or anyone who obtains the URL via history, Referer, or logs — can stream the blob and fetch the AES-128 key.

**Impact**

Continued access to deleted/revoked content and decryption keys via leaked or pre-issued tickets.

**Remediation**

Add `AND deleted_at IS NULL` to all ticket-gated lookups; validate the ticket's `user_id` against current access; shorten TTLs and rate-limit `stream_file` and the key endpoint.

**Verification**

- Streaming a trashed file with a previously valid ticket returns 404.
- Ticket issued for user A does not authorize user B's id mismatch (where applicable).

---

### SEC-019 — Runtime SSRF via admin-registered storage node URLs

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                 |
| **Category**       | SSRF                                                                                                 |
| **Impacted files** | `backend/src/admin/storage_nodes.rs` (`create_storage_node`, `update_storage_node`, `probe_storage_node`), `backend/src/storage/placement.rs`, `backend/src/storage/router.rs`, `backend/src/outbound_target.rs` |
| **Routes**         | `POST/PUT /api/v1/admin/storage/nodes`, node detail/list (probe)                                       |

**Description**

`outbound_target::validate_http_outbound_base_url` is only called from setup. Admin storage-node create/update accept any `http(s)://` URL after `normalize_base_url` only; the server then probes `/health/ready`, `/metrics`, and routes blob PUT/GET to it.

**Exploit scenario**

A compromised admin (or `instance.settings.manage` holder) registers `http://169.254.169.254` or an internal service URL. Listing/viewing nodes triggers server-side requests from the app's network position.

**Impact**

Internal network reconnaissance and cloud metadata access from a trusted server position.

**Remediation**

Apply `validate_http_outbound_base_url` on create/update/probe paths (with an explicit dev opt-in for private targets). Document storage management as a trusted operation.

**Verification**

- Registering a private/metadata URL is rejected unless private outbound is explicitly allowed.

---

### SEC-020 — SSRF filter is hostname-literal only (DNS rebinding + redirect bypass)

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | High                                                                                                 |
| **Category**       | SSRF                                                                                                 |
| **Impacted files** | `backend/src/outbound_target.rs` (`host_is_blocked`), `backend/src/setup/handlers.rs` (DB/storage test probes) |
| **Routes**         | `POST /api/v1/setup/database/test`, `POST /api/v1/setup/storage/test`, plus SEC-019 admin paths        |

**Description**

`host_is_blocked` parses literal IPs and blocklists hostnames, but never resolves DNS. A public hostname that resolves to a private/loopback/metadata IP passes validation. reqwest also follows redirects by default, and IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is not caught.

**Exploit scenario**

During the pre-setup window, an actor with the setup token submits `https://127.0.0.1.nip.io` or a public host returning `302 → http://169.254.169.254`. The probe connects to the internal target. (Residual class on top of the SEC-008/SEC-010 fixes.)

**Impact**

Internal-service and cloud-metadata probing despite literal-IP blocking.

**Remediation**

Resolve the hostname before connecting and re-check every resolved IP with `is_non_public_ip()`; restrict/validate redirects (`redirect::Policy`); block IPv4-mapped IPv6 and alternate encodings. Add tests for `nip.io`, redirects, and `::ffff:` forms.

**Verification**

- A hostname resolving to a private IP is rejected.
- A redirect to a private IP after validation is blocked.

---

### SEC-021 — Media processing DoS: no ffmpeg timeouts; image/GIF decompression bombs

- [x] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                               |
| **Impacted files** | `backend/src/hls/encoder.rs`, `backend/src/hls/probe.rs`, `backend/src/video/thumbnail.rs`, `backend/src/audio/waveform.rs`, `backend/src/files/gif_preview.rs`, `backend/src/image/thumbnail.rs` |

**Description**

All ffmpeg/ffprobe spawns use `child.wait().await` with no wall-clock timeout or kill-on-drop. The image thumbnailer fully decodes upload bytes before downscaling, with `max_upload_bytes` defaulting to **10 GiB**; GIF/WebP preview canvas dimensions are uncapped (frame count is capped at 480).

**Exploit scenario**

A crafted video/GIF/WebP (huge declared dimensions or pathological metadata) hangs or balloons memory in a worker; with 4 default workers, a few uploads exhaust CPU/RAM.

**Remediation**

Wrap ffmpeg in `tokio::time::timeout` + kill on expiry; cap concurrent transcodes per user; read image/GIF/WebP metadata and reject excessive pixel/canvas dimensions before decode.

---

### SEC-022 — HLS AES content key uploaded to object storage alongside ciphertext

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                               |
| **Impacted files** | `backend/src/hls/encoder.rs`, `backend/src/hls/handlers.rs` (`resolve_hls_aes_key`), `backend/src/hls/encode_job.rs` |

**Description**

The plain 16-byte HLS key is written to `{storage_key}/key.bin` and uploaded to Nebular; `resolve_hls_aes_key` prefers the object copy over the encrypted DB envelope. This undermines the AES-256-GCM at-rest protection of the `KeyStore`.

**Exploit scenario**

Leaked Nebular credentials, a misconfigured public bucket, or the long-lived service JWT (SEC-023) exposes keys next to the ciphertext segments — encryption adds little at rest.

**Remediation**

Keep keys only in the `KeyStore` (encrypted in Postgres); never upload `key.bin`; migrate existing objects.

---

### SEC-023 — Long-lived admin Nebular service JWT

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Severity**       | Medium                                                                 |
| **Impacted files** | `backend/src/storage/nebula.rs` (`generate_service_token`)              |

**Description**

The backend mints a Nebular service token with `role: "admin"` and `exp: now + 86400 * 365` (one year), sent as `Bearer` on every storage request.

**Exploit scenario**

A leak (memory dump, log misconfig, container inspect) grants full bucket-admin access for a year.

**Remediation**

Short-lived tokens with refresh; least-privilege Nebular role; never log `Authorization` headers.

---

### SEC-024 — Frontend: setup token in JS bundle; JWT and share passwords in web storage

- [x] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium (High in combination with any XSS or pre-setup exposure)                                       |
| **Impacted files** | `frontend/src/api/core.ts` (`VITE_SETUP_TOKEN`), `frontend/src/context/AuthContext.tsx` (`localStorage`), `frontend/src/lib/share-access.ts` (`sessionStorage`), `frontend/Dockerfile`, `docker-compose.yml` |

**Description**

`VITE_SETUP_TOKEN` is baked into the static bundle at build time (extractable from `/assets/*.js`). The session JWT and user profile are stored in `localStorage`, and share passwords in `sessionStorage` — all readable by any XSS.

**Exploit scenario**

Pre-setup: a visitor extracts the setup token and bootstraps the first admin (ties into SEC-005/SEC-013). Post-XSS: an attacker exfiltrates the JWT and cached share passwords.

**Remediation**

Never ship `VITE_SETUP_TOKEN` in production builds (use out-of-band bootstrap). Prefer HttpOnly+Secure+SameSite cookies for the session; keep share passwords in memory only.

---

### SEC-025 — Missing security headers on the nginx/static frontend

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                              |
| ------------------ | ------------------------------------------------------------------ |
| **Severity**       | Medium                                                            |
| **Impacted files** | `frontend/nginx.conf.template`                                     |

**Description**

No `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, or `Strict-Transport-Security`.

**Exploit scenario**

Clickjacking of login/setup/share-password forms; MIME sniffing; share tokens leaked via `Referer`; no CSP backstop if an XSS is introduced.

**Remediation**

Add a strict CSP, `frame-ancestors 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS (behind TLS).

---

### SEC-026 — Untrusted spreadsheet parsing in the browser (`xlsx` / SheetJS 0.18.5)

- [x] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                               |
| **Impacted files** | `frontend/package.json` (`xlsx@^0.18.5`), `frontend/src/lib/spreadsheet/parse.ts`, `frontend/src/components/drive/ExplorerSpreadsheetThumbnail.tsx` |

**Description**

Untrusted uploads are parsed with `XLSX.read(buffer, { cellFormula: true, cellStyles: true })` using an older community SheetJS build with known prototype-pollution/ReDoS/memory issues.

**Remediation**

Upgrade to a maintained SheetJS build; parse in a Web Worker with size/time limits; disable `cellFormula` for preview; consider server-side conversion.

---

### SEC-027 — Compose exposes Postgres/storage/API on `0.0.0.0` with dev credentials

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium (High/Critical if reachable beyond localhost)                                                  |
| **Impacted files** | `docker-compose.yml` (ports `5432`, `9000`, `3000`; `POSTGRES_PASSWORD:-ownly`; `TRUST_PROXY_HEADERS:-true`; `OWNLY_ALLOW_PRIVATE_OUTBOUND:-1`), `docker-compose.rep.yml`, `backend/src/lib.rs` (permissive CORS when origins empty) |

**Description**

Default Compose publishes Postgres (`ownly:ownly`), object storage, and the API on all interfaces; `TRUST_PROXY_HEADERS=true` enables `X-Forwarded-For` rate-limit bypass when the API is hit directly; `OWNLY_ALLOW_PRIVATE_OUTBOUND=1` and permissive CORS are defaults.

**Remediation**

Remove host port mappings for DB/storage (internal network only) in production; require strong DB passwords; set `TRUST_PROXY_HEADERS=false` unless solely behind a trusted proxy; default `OWNLY_ALLOW_PRIVATE_OUTBOUND=0` and require explicit `CORS_ALLOWED_ORIGINS` in production.

---

### SEC-028 — Login brute-force and account enumeration weaknesses

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Severity**       | Medium                                                                 |
| **Impacted files** | `backend/src/auth/handlers.rs` (`login`), `backend/src/rate_limit.rs`   |

**Description**

Login is rate-limited per IP only (no per-account lockout). When the email is not found, Argon2 is skipped, creating a timing oracle. Disabled accounts return `403` with a distinct message vs `401` for bad credentials, enabling account-state enumeration.

**Remediation**

Composite `login:{email_hash}:{ip}` key + exponential backoff/lockout; always run a dummy Argon2 verify on missing users; return a uniform `401` for all credential failures.

---

### SEC-029 — Last-admin guard gap in `delete_user`

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Severity**       | Medium                                                                 |
| **Impacted files** | `backend/src/admin/handlers.rs` (`delete_user` vs `update_user`)        |

**Description**

`update_user` uses `user_is_active_instance_admin()` (group **or** legacy `users.role='admin'`), but `delete_user` only checks admin-group membership before the last-admin block. An instance with a single legacy-role admin (not in the admin group) could be left with zero admins.

**Remediation**

Reuse `user_is_active_instance_admin()` + `count_other_active_instance_admins()` in `delete_user`, matching `update_user`.

---

### SEC-030 — Zip-slip via `..` folder names and unsanitized zip entry paths

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Severity**       | Medium                                                                 |
| **Impacted files** | `backend/src/files/folders.rs` (`normalize_folder_name`), `backend/src/files/folder_download.rs`, `backend/src/files/zip_job.rs` (`zip.start_file`) |

**Description**

`normalize_folder_name` rejects `/` and `\` but allows literal `..`. Zip entry paths are built as `{prefix}/{name}` and passed to `zip.start_file` without component sanitization.

**Exploit scenario**

A folder named `..` produces archive entries with `..` segments; a naive extractor writes outside the target directory (classic zip-slip) on the victim's machine.

**Remediation**

Reject `.`/`..` and any `..` segment in folder/file names; normalize each zip entry path (reject absolute paths and `..`) in a shared sanitizer used by folder/bulk/share zip builders.

---

### SEC-031 — No server-side logout / session-revocation endpoint

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Severity**       | Medium                                                                 |
| **Impacted files** | `backend/src/lib.rs` (auth routes), `backend/src/user_sessions.rs`      |

**Description**

There is no `POST /auth/logout`. The frontend "logout" only deletes the client-side token; the server-side `sid` stays valid until expiry. Server-side revocation exists only via admin APIs.

**Remediation**

Add `POST /api/v1/auth/logout` that revokes the current `sid` (and optionally all sessions); audit as `auth.logout`.

---

### SEC-032 — Plaintext secrets stored in `app_settings`

- [x] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Severity**       | Medium                                                                 |
| **Impacted files** | `backend/src/setup/handlers.rs` (DB URL persisted), `backend/src/admin/console.rs` (`smtp_password`) |

**Description**

Setup writes the full `database_url` (with credentials) into `app_settings`, and admin settings store `smtp_password` verbatim. GETs return `password_set: bool` (good), but a DB/backup compromise exposes the secrets.

**Remediation**

Encrypt secrets at rest (app-level or KMS); avoid persisting the full DB URL when env-only suffices post-setup.

---

### SEC-033 — Unbounded per-user background job enqueue

- [ ] **Not started** / [ ] **In progress** / [x] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Severity**       | Medium                                                                 |
| **Impacted files** | `backend/src/jobs/store.rs`, upload handlers calling `enqueue_job`      |

**Description**

Job dedup is per `(kind, resource_type, resource_id)` only. Each upload can enqueue HLS/thumbnail/waveform jobs with no per-user or global cap, enabling queue saturation and ffmpeg CPU/disk pressure.

**Remediation**

Per-user queued-job cap; throttle concurrent encodes per user; global queue-depth alerting.

---

### SEC-034 — Public share leaks trashed subfolders; grantee uploads create owner-invisible files

- [x] **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                               |
| **Impacted files** | `backend/src/shares/handlers.rs` (`public_share_contents`), `backend/src/files/handlers.rs` (grantee upload `user_id`/`folder_id`) |

**Description**

(a) `public_share_contents` lists child folders without `deleted_at IS NULL`, so trashed subfolder names leak to anonymous visitors (files inside are already hidden). (b) Grantee uploads into a shared folder store `user_id = grantee` with the owner's `folder_id`; the owner's listings filter `f.user_id = $1`, so the file is invisible to the owner while the grantee retains control.

**Remediation**

Add `AND deleted_at IS NULL` to the share subfolder query; define a clear ownership/visibility model for grantee uploads (set owner `user_id`, or reject uploads into non-owned folders).

---

### SEC-035 – SEC-042 — Low-severity findings

All open. Tracked in one table for brevity.


| ID      | Title                                                | Severity | Impacted files                                              | Remediation summary |
| ------- | ---------------------------------------------------- | -------- | ----------------------------------------------------------- | ------------------- |
| SEC-035 | Non-constant-time setup-token comparison             | Low      | `backend/src/setup/handlers.rs` (`provided != setup_token`) | Use `subtle::ConstantTimeEq`. |
| SEC-036 | JWT algorithm not explicitly pinned                  | Low      | `backend/src/auth/handlers.rs` (`Validation::default()`)    | `Validation::new(Algorithm::HS256)`. |
| SEC-037 | `rand::thread_rng()` for HLS keys / share tokens     | Low      | `backend/src/hls/key_store.rs`, `backend/src/shares/store.rs` | Use `OsRng`/`getrandom` for all key/token material. |
| SEC-038 | Master key derived by truncation, not a KDF          | Low      | `backend/src/hls/key_store.rs` (`KeyStore::new`)            | Derive via HKDF-SHA256/SHA-256 of the full secret. |
| SEC-039 | Legacy HLS key blobs decrypt with a static zero nonce| Low      | `backend/src/hls/key_store.rs` (`is_legacy_encrypted_blob`) | Force migration to random-nonce envelope at startup. |
| SEC-040 | Audit write failures silently swallowed (`.ok()`)    | Low      | `backend/src/admin/*`, share/auth handlers                  | Log audit failures at `error`; consider retry/fail-closed for critical mutations. |
| SEC-041 | `graphify-out/` and `ios/**/xcuserdata/` tracked     | Low      | `.gitignore`, repo tree                                     | **Fixed:** gitignored; removed from index; CI/docs treat as generated artifacts. History cleanup optional in PR. |
| SEC-042 | `init-env.sh` does not restrict `.env` permissions   | Low      | `init-env.sh`                                               | `umask 077` + `chmod 600` on generated env files. |


---

## Areas reviewed — no critical issues found


| Area                                                                                   | Result                                                                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Admin mutations (`create_user`, `update_user`, `delete_user`, settings, storage nodes) | `require_admin` called on handlers; routes under auth middleware                                                          |
| Protected route gating                                                                 | `/api/v1` admin and user routes wrapped with `auth_middleware` in `lib.rs`                                                |
| JWT validation                                                                         | Signature + expiry checked; session revocation checked via `user_sessions`                                                |
| Error responses                                                                        | `AppError` envelope avoids leaking stack traces/SQL in client JSON                                                        |
| File list/search IDOR (active library)                                                 | Listing scoped by `user_id` and `deleted_at IS NULL` in normal browse paths                                               |
| Bulk/folder download jobs                                                              | User-bound job registry and ownership checks before archive access (see SEC-011 for deleted_at gap in zip source queries) |
| Storage adapter path traversal                                                         | Object keys appear DB-derived; no direct filesystem path from user input                                                  |
| CSRF on admin mutations                                                                | Bearer token in `Authorization` header (not cookie session); classic CSRF less applicable                                 |
| Frontend API bypass                                                                    | `frontend/src/api/client.ts` attaches JWT; does not weaken server checks                                                  |


---

## Assumptions and limits

- **Static review only** — no dynamic scanning or dependency CVE audit. (Round 2 added infrastructure, Docker/Compose, CI, and frontend review; Round 1 was backend + access control only.)
- **Header spoofing (SEC-006)** severity depends on whether the API is exposed directly or only behind a correctly configured reverse proxy.
- **Setup race (SEC-005)** exploitability depends on network exposure during first boot.
- **Nebular OS / object storage** — not fully audited here; focus was API + Postgres access control.
- **Dependency vulnerabilities** — run `cargo audit` and `npm audit` separately.

---

## Suggested verification commands (after fixes)

```bash
# Backend
cd backend && cargo test -p ownly-backend
cd backend && cargo clippy -p ownly-backend -- -D warnings

# Frontend
cd frontend && npm run build && npm run lint
```

Add or extend integration tests in `backend/tests/` for:

- Admin demotion invalidates prior token (SEC-002)
- Trashed file blocked on download and public share (SEC-003, SEC-004)
- Trashed file excluded from folder/bulk zip archives (SEC-011)
- Setup endpoints blocked or redacted post-setup (SEC-001)
- Setup DB/storage test probes restricted (SEC-008, SEC-010)

---

## Changelog


| Date       | Author                  | Notes                       |
| ---------- | ----------------------- | --------------------------- |
| 2026-06-02 | Security audit (static) | Initial findings documented |
| 2026-06-02 | Follow-up static review | SEC-007–SEC-009 added       |
| 2026-06-02 | Follow-up static review | SEC-010–SEC-011 added       |
| 2026-06-03 | Audit scripts           | SEC-010–SEC-011 probe scripts added |
| 2026-06-04 | Audit scripts           | SEC-012 live setup-hijack exploit script added |
| 2026-06-07 | Security remediation    | SEC-001–SEC-012 implemented in backend + frontend |
| 2026-06-11 | Security remediation    | Round 2: SEC-013–SEC-020, SEC-022–023, SEC-025, SEC-028–031, SEC-033, SEC-035–036, SEC-042; integration exploit tests SEC-014–018 |


