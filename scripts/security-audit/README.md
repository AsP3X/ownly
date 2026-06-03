# Security audit scripts

Standalone probes for findings in [`security-audit.md`](../../security-audit.md). No application code imports — point at any running API.

## Setup for contributors (recommended)

These scripts are intentionally lightweight. **Security audit scripts use only the Python standard library** (`urllib` for HTTP, `argparse`, `json`, `unittest`, etc. — no third-party packages required to run the probes or their unit tests).

`scripts/storage-audit.py` (sibling script) is the only one that needs an external package (`psycopg[binary]` for Postgres).

For normal contributors we provide cross-platform setup scripts so you get a clean isolated environment without installing anything globally or debugging Python packaging.

### 1. Create the virtual environment

From the repository root:

**macOS / Linux**
```bash
bash scripts/setup-test-env.sh
```

**Windows (Command Prompt or PowerShell)**
```bat
scripts\setup-test-env.bat
```

This creates `scripts/.venv/` (git-ignored) and installs the minimal requirements.

### 2. Activate

- **macOS / Linux**: `source scripts/.venv/bin/activate`
- **Windows cmd**: `scripts\.venv\Scripts\activate.bat`
- **Windows PowerShell**: `scripts\.venv\Scripts\Activate.ps1`

After activation you can type `python` (instead of `python3`) and the environment is isolated. Use `deactivate` to leave it.

**Without activating the shell** (handy for one-offs or CI):
```bash
# Unix/macOS/Linux
scripts/.venv/bin/python scripts/security-audit/sec001_setup_info_disclosure.py --help
scripts/.venv/bin/python -m unittest discover -s scripts/security-audit/tests -v

# Windows
scripts\.venv\Scripts\python.exe scripts\security-audit\sec001_setup_info_disclosure.py --help
```

See the contents of `scripts/setup-test-env.sh` (or `.bat`) for the exact commands if you ever need to recreate manually.

### Unit tests (run these locally — no live API needed)

```bash
python -m unittest discover -s scripts/security-audit/tests -v
```

Or via make (see below).

### Makefile convenience targets

```bash
make -C scripts/security-audit sec001
make -C scripts/security-audit test
```

The Makefile auto-detects `../.venv` (created by the setup script) and uses its Python when present — so `make -C scripts/security-audit sec001` etc. "just work" for contributors who ran the setup. It falls back to `python3`. You can still force a specific interpreter:
```bash
make -C scripts/security-audit PYTHON=python sec002
```

### Storage-audit.py

The shared venv also covers the storage audit script (`scripts/storage-audit.py`). It compares Postgres `files.size_bytes` (logical) against on-disk Nebular blob sizes. Requires `DATABASE_URL` (and optionally `NEBULAR_DATA_DIR`). See [`docs/storage-disk-tuning.md`](../../docs/storage-disk-tuning.md) for details and example environment.

## SEC-001 — setup endpoint disclosure

See the **Setup for contributors** section above for venv activation (recommended for local work). The examples below use the classic `python3` form that works everywhere (CI, fresh clones, etc.).

```bash
# Default: human report, secrets redacted in output
python3 scripts/security-audit/sec001_setup_info_disclosure.py
```

> **Tip:** After activating `scripts/.venv` you can use plain `python scripts/security-audit/...` (and `make` targets will auto-pick the venv Python).

# Custom target
python3 scripts/security-audit/sec001_setup_info_disclosure.py --base-url https://your-host

# CI / automation
python3 scripts/security-audit/sec001_setup_info_disclosure.py --base-url http://127.0.0.1:8080 --json --quiet
python3 scripts/security-audit/sec001_setup_info_disclosure.py --sarif > sec001.sarif

# Full leaked values (interactive, or SEC001_I_KNOW=1 in CI)
python3 scripts/security-audit/sec001_setup_info_disclosure.py --no-redaction

# Baseline after fix
python3 scripts/security-audit/sec001_setup_info_disclosure.py --save-baseline /tmp/sec001-ok.json
python3 scripts/security-audit/sec001_setup_info_disclosure.py --compare-baseline /tmp/sec001-ok.json
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | No vulnerability indicators |
| 1 | Vulnerable |
| 2 | Unreachable / inconclusive |
| 3 | `--compare-baseline` mismatch |

### Flags (CLI)

| Flag | Description |
|------|-------------|
| `--base-url` | API origin |
| `--no-redaction` | Print raw secrets (requires TTY or `SEC001_I_KNOW=1`) |
| `--json` / `--sarif` | Machine-readable output |
| `--quiet` | No stdout report (exit code only) |
| `--compact` | Fewer duplicate checklist lines |
| `--strict` | Stricter credential heuristics |
| `--retries N` | Retry unreachable target |
| `--fail-fast` | Stop after first fail |
| `--output-file PATH` | Write redacted JSON report |
| `--save-baseline` / `--compare-baseline` | Regression compare |

Environment mirrors flags: `SEC001_BASE_URL`, `SEC001_API_PREFIX`, `SEC001_RETRIES`, `SEC001_QUIET`, etc.

### Makefile & unit tests

See the **Setup for contributors** section at the top of this document (recommended venv + activation). The commands below still work:

```bash
make -C scripts/security-audit sec001
make -C scripts/security-audit test
python3 -m unittest discover -s scripts/security-audit/tests -v
```

## SEC-002 — stale JWT admin role after demotion

Requires **two distinct admin accounts**: a **subject** (demoted) and a **demoter** (performs `PATCH`). By default the script restores the subject to `admin` after the probe.

Credentials are **required**. Either export `SEC002_*` variables, pass CLI flags, or add the commented keys from `.env.example` to your gitignored repo **`.env`** (the script loads `SEC002_*` from `.env` automatically when you run from the project tree).

**Quick start (one admin — recommended):**

```bash
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --bootstrap-subject --prompt
```

Creates a temporary `sec002-audit-*@audit.local` admin, runs the demotion probe, then deletes it.

**Two admins (interactive):**

```bash
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --prompt
```

**Or** export / `.env`:

```bash
export SEC002_SUBJECT_EMAIL=admin-a@example.com
export SEC002_SUBJECT_PASSWORD='...'
export SEC002_DEMOTER_EMAIL=admin-b@example.com
export SEC002_DEMOTER_PASSWORD='...'

python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --base-url http://127.0.0.1:8080

# CI / automation
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --base-url http://127.0.0.1:8080 --json --quiet
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --sarif > sec002.sarif

# Leave subject demoted (manual restore)
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --no-restore

# Baseline after fix
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --save-baseline /tmp/sec002-ok.json
python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --compare-baseline /tmp/sec002-ok.json
```

### Exit codes

Same as SEC-001: `0` ok, `1` vulnerable, `2` inconclusive, `3` baseline drift.

### Flags (CLI)

| Flag | Description |
|------|-------------|
| `--base-url` | API origin |
| `--subject-email` / `--subject-password` | Admin account to demote |
| `--demoter-email` / `--demoter-password` | Second admin that performs demotion |
| `--demote-role` | Target role after demotion (default: `pro`) |
| `--admin-probe-route` | Admin route to probe (default: `/admin/users`) |
| `--no-restore` | Do not PATCH subject back to `admin` after probe |
| `--no-redaction` | Print raw JWTs (requires TTY or `SEC002_I_KNOW=1`) |
| `--json` / `--sarif` | Machine-readable output |
| `--quiet` | Exit code only |
| `--compact` | Fewer duplicate checklist lines |
| `--retries N` | Retry unreachable target |
| `--fail-fast` | Stop after first fail |
| `--output-file PATH` | Write redacted JSON report |
| `--save-baseline` / `--compare-baseline` | Regression compare |

Environment mirrors flags: `SEC002_BASE_URL`, `SEC002_SUBJECT_EMAIL`, `SEC002_DEMOTER_EMAIL`, `SEC002_RETRIES`, `SEC002_QUIET`, etc.

**zsh/bash:** assignments like `SEC002_DEMOTER_EMAIL=...` on their own line are **not** passed to `python3` unless you `export` them or put them on the **same line** as the python command.

### Makefile

See the **Setup for contributors** section (top of this file) for venv instructions. Quick examples:

```bash
make -C scripts/security-audit sec002
make -C scripts/security-audit test
```

## SEC-003 — public share exposes recycle-bin files

Probes **folder** public shares: after the owner soft-deletes a file inside the shared folder, anonymous `GET /public/shares/{token}/all-files` and `/download` must not expose it.

Credentials are **required** (`SEC003_OWNER_*`). Bootstrap (default) finds or creates a folder, uploads a tiny probe file if needed, and creates the share.

```bash
python3 scripts/security-audit/sec003_public_share_soft_delete.py --prompt
```

```bash
export SEC003_OWNER_EMAIL='owner@example.com'
export SEC003_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec003_public_share_soft_delete.py
```

```bash
python3 scripts/security-audit/sec003_public_share_soft_delete.py --json --quiet \
  --owner-email "$SEC003_OWNER_EMAIL" --owner-password "$SEC003_OWNER_PASSWORD"
```

| Flag | Description |
|------|-------------|
| `--owner-email` / `--owner-password` | Drive owner |
| `--share-password` | Optional `x-share-password` header |
| `--folder-id` / `--file-id` / `--share-token` | Skip bootstrap when pre-provisioned |
| `--no-bootstrap` | Require explicit ids + token |
| `--no-restore` | Leave probe file in recycle bin |
| `--prompt` | Interactive owner credentials |

Environment: `SEC003_*` (loaded from repo `.env` when present). Use `export` or one-line env prefix before `python3`.

### Makefile

See the **Setup for contributors** section (top of this file) for venv instructions. Quick examples:

```bash
make -C scripts/security-audit sec003
make -C scripts/security-audit test
```

## SEC-004 — authenticated download of recycle-bin files

Probes owner JWT access to `GET /files/{id}/download`, `/download-url`, and `/preview-url` after soft-delete.

```bash
python3 scripts/security-audit/sec004_authenticated_trash_download.py --prompt
```

```bash
export SEC004_OWNER_EMAIL='owner@example.com'
export SEC004_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec004_authenticated_trash_download.py
```

| Flag | Description |
|------|-------------|
| `--owner-email` / `--owner-password` | Drive owner |
| `--file-id` | Skip bootstrap when set |
| `--no-bootstrap` | Require `--file-id` |
| `--no-restore` | Leave probe in recycle bin |
| `--prompt` | Interactive credentials |

Environment: `SEC004_*` (also loaded from repo `.env`). Use `export` or one-line env prefix.

### Makefile

See the **Setup for contributors** section (top of this file) for venv instructions. Quick examples:

```bash
make -C scripts/security-audit sec004
make -C scripts/security-audit test
```

## SEC-005 — unauthenticated setup bootstrap race

Probes `POST /api/v1/setup` without credentials using a **safe invalid body** (short password → 400). Detects missing bootstrap-token enforcement; does not complete setup on initialized instances (expects 409).

```bash
python3 scripts/security-audit/sec005_setup_bootstrap_race.py
python3 scripts/security-audit/sec005_setup_bootstrap_race.py --base-url http://127.0.0.1:8080
```

| Flag | Description |
|------|-------------|
| `--base-url` | API origin |
| `--bootstrap-header` | Header name to probe (default `X-Setup-Token`) |
| `--require-setup-complete` | Inconclusive when `setup_complete=false` |
| `--json` / `--sarif` | Machine-readable output |

Environment: `SEC005_*` (optional `.env`). No credentials required.

On a **fixed** deployment with `SETUP_TOKEN`, exit **0**. On current code (post-setup), exit **1** — POST returns 409 without checking a bootstrap secret.

### Makefile

See the **Setup for contributors** section (top of this file) for venv instructions. Quick examples:

```bash
make -C scripts/security-audit sec005
make -C scripts/security-audit test
```

## SEC-006 — login/register rate limit and spoofed forwarding headers

Sends `login_rpm + 1` failed login attempts with a **fixed** `X-Forwarded-For`, then the same count with a **unique** IP per request. **Vulnerable** when the fixed burst is throttled (429) but the rotated burst is not.

```bash
python3 scripts/security-audit/sec006_rate_limit_forwarded_headers.py
python3 scripts/security-audit/sec006_rate_limit_forwarded_headers.py --base-url http://127.0.0.1:8080
```

| Flag | Description |
|------|-------------|
| `--base-url` | API origin |
| `--login-rpm` | Expected login cap per minute (default 15, match `AUTH_LOGIN_RPM`) |
| `--register-rpm` | Expected register cap (default 5) |
| `--skip-register` | Only probe `POST /auth/login` |
| `--json` / `--sarif` | Machine-readable output |

No credentials. Uses wrong passwords / invalid register email so no accounts are created. Takes ~32+ HTTP requests (two login bursts + optional register bursts).

### Makefile

See the **Setup for contributors** section (top of this file) for venv instructions. Quick examples:

```bash
make -C scripts/security-audit sec006
make -C scripts/security-audit test
```

## SEC-007 — password-protected share overview bypass

Creates a **password-protected** folder public share, then calls `GET /public/shares/{token}` **without** `x-share-password`. **Vulnerable** when overview JSON still includes metadata (e.g. `shared_by_email`). Compares with `GET .../contents` (should stay 403) and overview with correct password (should 200).

```bash
python3 scripts/security-audit/sec007_share_overview_password_bypass.py --prompt
```

```bash
export SEC007_OWNER_EMAIL='owner@example.com'
export SEC007_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec007_share_overview_password_bypass.py
```

| Flag | Description |
|------|-------------|
| `--owner-email` / `--owner-password` | Drive owner |
| `--share-password` | Visitor password (default `sec007-audit-pass`) |
| `--share-token` / `--share-id` | Skip bootstrap when set |
| `--no-bootstrap` | Require share ids + token |
| `--no-revoke` | Leave probe share active |

Environment: `SEC007_*` (also loaded from repo `.env`). Use `export` or one-line env prefix.

### Makefile

See the **Setup for contributors** section (top of this file) for venv instructions. Quick examples:

```bash
make -C scripts/security-audit sec007
make -C scripts/security-audit test
```

## SEC-008 — setup storage test SSRF / internal recon

Sends unauthenticated `POST /setup/storage/test` with internal URLs (`127.0.0.1`, `169.254.169.254`, `10.0.0.1`). **Vulnerable** when targets are not rejected before an outbound health probe (400 “could not reach” still counts).

```bash
python3 scripts/security-audit/sec008_setup_storage_ssrf.py
```

On **initialized** instances (`setup_complete=true`), SSRF probes are skipped; the script still verifies the endpoint returns **409** after setup. Use a **fresh/pre-setup** stack for full SSRF detection, or pass `--require-pre-setup` to fail when setup is already complete.

| Flag | Description |
|------|-------------|
| `--base-url` | API origin |
| `--require-pre-setup` | Exit inconclusive if `setup_complete=true` |
| `--json` / `--sarif` | Machine-readable output |

No credentials required.

### Makefile

See the **Setup for contributors** section (top of this file) for venv instructions. Quick examples:

```bash
make -C scripts/security-audit sec008
make -C scripts/security-audit test
```

## SEC-009 — public share password brute-force throttling

Creates a **password-protected** folder share, confirms `GET /public/shares/{token}/contents` rejects wrong `x-share-password`, then sends many unique wrong guesses. **Vulnerable** when attempts keep returning **403** without **429** (also checks `X-Forwarded-For` rotation like SEC-006).

```bash
python3 scripts/security-audit/sec009_share_password_bruteforce.py --prompt
```

```bash
export SEC009_OWNER_EMAIL='owner@example.com'
export SEC009_OWNER_PASSWORD='...'
python3 scripts/security-audit/sec009_share_password_bruteforce.py
```

| Flag | Description |
|------|-------------|
| `--owner-email` / `--owner-password` | Drive owner |
| `--share-password` | Correct visitor password (default `sec009-audit-pass`) |
| `--wrong-attempts` | Failed guesses to send (default 12) |
| `--share-token` / `--share-id` | Skip bootstrap when set |
| `--no-bootstrap` | Require share ids + token |
| `--no-revoke` | Leave probe share active |
| `--prompt` | Interactive credentials |

Environment: `SEC009_*` (also loaded from repo `.env`). Use `export` or one-line env prefix.

### Makefile

```bash
make -C scripts/security-audit sec009
make -C scripts/security-audit test
```
