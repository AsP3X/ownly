# Human: Entry orchestration for SEC-002 audit script.
# Agent: READS Sec002Config; CALLS runner_sec002 + report_sec002; RETURNS exit code.

from __future__ import annotations

import json
import sys

from .config_sec002 import (
    credential_setup_hint,
    env_file_diagnostic,
    load_config,
    missing_credential_fields,
    parse_cli,
)
from .constants_sec002 import AUDIT_ID
from .report_sec002 import render_report, write_outputs
from .runner_sec002 import run_sec002_audit, validate_target_url


def _exit_missing_credentials(cfg, missing: list[str], *, bootstrap: bool = False) -> int:
    http = cfg.http
    hint = credential_setup_hint(bootstrap=bootstrap)
    if http.output_format == "json":
        payload = {
            "audit_id": AUDIT_ID,
            "verdict": "inconclusive",
            "exit_code": 2,
            "missing": missing,
            "hint": hint,
        }
        diag = env_file_diagnostic(bootstrap=bootstrap)
        if diag:
            payload["env_diagnostic"] = diag
        print(json.dumps(payload, indent=2))
        return 2
    if not http.quiet:
        need = "demoter admin credentials" if bootstrap else "two admin accounts"
        print(f"SEC-002: cannot run without {need}.", file=sys.stderr)
        print(f"Missing: {', '.join(missing)}", file=sys.stderr)
        diag = env_file_diagnostic(bootstrap=bootstrap)
        if diag:
            print(diag, file=sys.stderr)
        else:
            print(hint, file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    cfg = load_config(cli)
    missing = missing_credential_fields(cfg)
    if missing:
        return _exit_missing_credentials(cfg, missing, bootstrap=cfg.bootstrap_subject)
    err = validate_target_url(cfg)
    if err:
        print(err, file=sys.stderr)
        return 2
    report, _cache = run_sec002_audit(cfg)
    extra = write_outputs(report, cfg.http)
    render_report(report, cfg)
    if extra is not None:
        return extra
    return report.exit_code
