# Security audit scripts

Standalone probes for findings in [`security-audit.md`](../../security-audit.md). No application code imports — point at any running API.

## SEC-001 — setup endpoint disclosure

```bash
# Default: human report, secrets redacted in output
python3 scripts/security-audit/sec001_setup_info_disclosure.py

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

### Makefile

```bash
make -C scripts/security-audit sec001
make -C scripts/security-audit test
```

### Unit tests

```bash
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

```bash
make -C scripts/security-audit sec004
make -C scripts/security-audit test
```
