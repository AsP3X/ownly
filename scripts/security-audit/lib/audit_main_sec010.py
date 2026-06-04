# Human: Entry orchestration for SEC-010 audit script.
# Agent: READS Sec010Config; CALLS runner_sec010 + report_sec010; RETURNS exit code.

from __future__ import annotations

import sys

from .config_sec010 import load_config, parse_cli
from .report_sec010 import render_report, write_outputs
from .runner_sec010 import run_sec010_audit, validate_target_url


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    cfg = load_config(cli)
    err = validate_target_url(cfg)
    if err:
        print(err, file=sys.stderr)
        return 2
    report, _cache = run_sec010_audit(cfg)
    extra = write_outputs(report, cfg.http)
    render_report(report, cfg)
    if extra is not None:
        return extra
    return report.exit_code
