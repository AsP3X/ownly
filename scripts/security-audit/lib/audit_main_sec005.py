# Human: Entry orchestration for SEC-005 audit script.
# Agent: READS Sec005Config; CALLS runner_sec005 + report_sec005; RETURNS exit code.

from __future__ import annotations

import sys

from .config_sec005 import load_config, parse_cli
from .report_sec005 import render_report, write_outputs
from .runner_sec005 import run_sec005_audit, validate_target_url


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    cfg = load_config(cli)
    err = validate_target_url(cfg)
    if err:
        print(err, file=sys.stderr)
        return 2
    report, _cache = run_sec005_audit(cfg)
    extra = write_outputs(report, cfg.http)
    render_report(report, cfg)
    if extra is not None:
        return extra
    return report.exit_code
