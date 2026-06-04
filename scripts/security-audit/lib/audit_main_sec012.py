# Human: Entry orchestration for SEC-012 live exploit script.
# Agent: READS Sec012Config; CALLS runner_sec012 + report_sec012; RETURNS exit code.

from __future__ import annotations

import sys

from .config_sec012 import load_config, parse_cli
from .report_sec012 import render_report, write_outputs
from .runner_sec012 import run_sec012_audit, validate_target_url


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    cfg = load_config(cli)
    err = validate_target_url(cfg)
    if err:
        print(err, file=sys.stderr)
        return 2
    report, cache = run_sec012_audit(cfg)
    extra = write_outputs(report, cfg)
    render_report(report, cfg, cache)
    if extra is not None:
        return extra
    return report.exit_code
