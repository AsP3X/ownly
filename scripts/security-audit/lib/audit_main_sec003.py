# Human: Entry orchestration for SEC-003 audit script.
# Agent: READS Sec003Config; CALLS runner_sec003 + report_sec003; RETURNS exit code.

from __future__ import annotations

import json
import sys

from .config_sec003 import (
    credential_setup_hint,
    env_file_diagnostic,
    load_config,
    missing_credential_fields,
    parse_cli,
)
from .constants_sec003 import AUDIT_ID
from .report_sec003 import render_report, write_outputs
from .runner_sec003 import run_sec003_audit, validate_target_url


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
        print("SEC-003: cannot run without owner credentials.", file=sys.stderr)
        print(f"Missing: {', '.join(missing)}", file=sys.stderr)
        diag = env_file_diagnostic()
        print(diag if diag else hint, file=sys.stderr)
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
    report, _cache = run_sec003_audit(cfg)
    extra = write_outputs(report, cfg.http)
    render_report(report, cfg)
    if extra is not None:
        return extra
    return report.exit_code
