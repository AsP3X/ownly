# Human: Entry orchestration for SEC-004 audit script.
# Agent: READS Sec004Config; CALLS runner_sec004 + report_sec004; RETURNS exit code.

from __future__ import annotations

import json
import sys

from .config_sec004 import (
    credential_setup_hint,
    env_file_diagnostic,
    load_config,
    missing_credential_fields,
    parse_cli,
)
from .constants_sec004 import AUDIT_ID
from .report_sec004 import render_report, write_outputs
from .runner_sec004 import run_sec004_audit, validate_target_url


def _exit_missing_credentials(cfg, missing: list[str]) -> int:
    http = cfg.http
    hint = credential_setup_hint()
    if http.output_format == "json":
        payload = {
            "audit_id": AUDIT_ID,
            "verdict": "inconclusive",
            "exit_code": 2,
            "missing": missing,
            "hint": hint,
        }
        diag = env_file_diagnostic()
        if diag:
            payload["env_diagnostic"] = diag
        print(json.dumps(payload, indent=2))
        return 2
    if not http.quiet:
        print("SEC-004: cannot run without owner credentials.", file=sys.stderr)
        print(f"Missing: {', '.join(missing)}", file=sys.stderr)
        print(env_file_diagnostic() or hint, file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    cfg = load_config(cli)
    missing = missing_credential_fields(cfg)
    if missing:
        return _exit_missing_credentials(cfg, missing)
    err = validate_target_url(cfg)
    if err:
        print(err, file=sys.stderr)
        return 2
    report, _cache = run_sec004_audit(cfg)
    extra = write_outputs(report, cfg.http)
    render_report(report, cfg)
    if extra is not None:
        return extra
    return report.exit_code
