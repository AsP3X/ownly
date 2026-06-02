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
