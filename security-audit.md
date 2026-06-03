# Security Audit — Ownly / MediaVault Stack

**Date:** 2026-06-02  
**Scope:** Static code review of authentication, authorization, setup/bootstrap, file/share access, and admin mutation paths.  
**Method:** Backend route wiring, middleware, SQL access checks, share scope queries, and frontend API client alignment. No live penetration testing was performed.

Use the checkboxes below to track remediation as you work through each item.

---

## Executive summary


| Severity | Count | Open |
| -------- | ----- | ---- |
| High     | 4     | 4    |
| Medium   | 7     | 7    |
| Low      | 0     | 0    |


**Recommended fix order:** SEC-001 → SEC-007 → SEC-002 → SEC-003 → SEC-008 → SEC-010 → SEC-004 → SEC-011 → SEC-005 → SEC-006 → SEC-009

---

## Findings

### SEC-001 — Public setup endpoints leak database credentials and infrastructure metadata

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


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

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                        |
| **Category**       | Data extraction / infrastructure reconnaissance                                                               |
| **Impacted files** | `backend/src/setup/handlers.rs` (`test_setup_database`), `backend/src/db.rs` (`test_connection`, `init_pool`) |
| **Routes**         | `POST /api/v1/setup/database/test`                                                                            |


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

**Verification**

- Unauthenticated setup DB test without valid bootstrap token → 401/403 (when token enforced).
- URLs targeting `127.0.0.1` and private ranges are rejected before outbound connect.

---

### SEC-011 — Folder and bulk zip archives include soft-deleted (recycle-bin) files

- **Not started** / [ ] **In progress** / [ ] **Fixed** / [ ] **Accepted risk**


| Field              | Detail                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                                                         |
| **Category**       | Data extraction                                                                                                                                |
| **Impacted files** | `backend/src/files/folder_download.rs` (`collect_zip_entries_for_folder`), `backend/src/files/zip_job.rs` (`collect_zip_entries_for_file_ids`) |
| **Routes**         | `POST /api/v1/folders/{id}/download`, `POST /api/v1/files/download`                                                                            |


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

**Verification**

- Folder zip of a tree with trashed files excludes trashed members.
- Bulk download with a trashed `file_id` → 400/404.
- Regression test aligned with SEC-003/SEC-004 recycle-bin behavior.

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


