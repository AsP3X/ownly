# Human: Entry orchestration for SEC-001 audit script.
# Agent: READS Config; CALLS runner_sec001 + report; RETURNS exit code.

from __future__ import annotations

import sys

from .config import load_config, parse_cli
from .report import render_report, write_outputs
from .runner_sec001 import run_sec001_audit, validate_target_url


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    cfg = load_config(cli)
    err = validate_target_url(cfg)
    if err:
        print(err, file=sys.stderr)
        return 2
    report, _cache = run_sec001_audit(cfg)
    extra = write_outputs(report, cfg)
    render_report(report, cfg)
    if extra is not None:
        return extra
    return report.exit_code
