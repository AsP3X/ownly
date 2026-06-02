# Human: Human-readable and JSON reporting for SEC-005 audits.
# Agent: WRITES stdout/files; respects quiet/json/sarif/redact flags.

from __future__ import annotations

import json
import os
import sys

from .compare import compare_to_baseline, report_to_dict, save_baseline
from .config_sec005 import loaded_env_file_path
from .constants_sec005 import AUDIT_ID, CASE_LABELS, ROUTE_SETUP
from .models import AuditReport, CaseResult, Config, LeakEvidence, Sec005Config
from .redact import redact_field_for_display
from .sarif_sec005 import sarif_json


class AuditReporter:
    def __init__(self, cfg: Config, sec005: Sec005Config) -> None:
        self.cfg = cfg
        self.sec005 = sec005
        self.use_color = sys.stdout.isatty() and not os.environ.get("NO_COLOR", "").strip()
        self.width = 72

    def _c(self, code: str, text: str) -> str:
        if not self.use_color:
            return text
        return f"\033[{code}m{text}\033[0m"

    def green(self, text: str) -> str:
        return self._c("32", text)

    def red(self, text: str) -> str:
        return self._c("31", text)

    def yellow(self, text: str) -> str:
        return self._c("33", text)

    def dim(self, text: str) -> str:
        return self._c("2", text)

    def bold(self, text: str) -> str:
        return self._c("1", text)

    def banner(self) -> None:
        title = f"{AUDIT_ID}  Setup bootstrap race audit"
        inner = self.width - 2
        pad = max(0, inner - len(title) - 2)
        print()
        print(self.bold(f"╭{'─' * inner}╮"))
        print(self.bold(f"│ {title}{' ' * pad} │"))
        print(self.bold(f"╰{'─' * inner}╯"))
        print()
        print(f"  {'Target':<12} {self.cfg.base_url}{self.cfg.api_prefix}")
        if loaded_env_file_path():
            print(f"  {'Env file':<12} {self.dim(str(loaded_env_file_path()))}")
        print(
            f"  {'Attack':<12} {self.dim(f'unauthenticated POST {ROUTE_SETUP} (invalid probe body)')}"
        )
        print(
            f"  {'Probe':<12} {self.dim(f'bootstrap header: {self.sec005.bootstrap_header}')}"
        )

    def status_icon(self, result: CaseResult) -> str:
        if result.passed:
            return self.green("✓")
        if result.severity == "error":
            return self.yellow("!")
        return self.red("✗")

    def print_checks(self, report: AuditReport) -> None:
        for result in report.results:
            label = CASE_LABELS.get(result.name, result.name.replace("_", " "))
            line = f"  {self.status_icon(result)}  {label}"
            if not result.passed:
                line += self.dim(f"  —  {redact_field_for_display('detail', result.detail)}")
            print(line)

    def summary_block(self, report: AuditReport) -> None:
        fails = [r for r in report.results if not r.passed and r.severity == "fail"]
        errors = [r for r in report.results if not r.passed and r.severity == "error"]
        passes = [r for r in report.results if r.passed]
        print()
        print(self.bold("  Summary"))
        print(self.dim("  " + "─" * self.width))
        print(f"  {self.green('Passed'):<10} {len(passes)}")
        print(f"  {self.red('Failed'):<10} {len(fails)}")
        print(f"  {self.yellow('Errors'):<10} {len(errors)}")
        if report.remediation_hints:
            print()
            print(self.bold("  Remediation"))
            for hint in report.remediation_hints:
                print(f"  • {hint}")
        print()
        print(self.bold("  Verdict"))
        if report.verdict == "vulnerable":
            print(f"  {self.red('✗  VULNERABLE')}")
            print(self.dim("     See security-audit.md → SEC-005"))
        elif report.verdict == "inconclusive":
            print(f"  {self.yellow('?  INCONCLUSIVE')}")
        else:
            print(f"  {self.green('✓  OK')}")
        if report.setup_complete is False:
            print()
            print(
                self.dim(
                    "  Note: instance is pre-setup — finding confirms public setup on fresh deploys."
                )
            )

    def print_human(self, report: AuditReport) -> None:
        self.banner()
        print()
        print(self.bold("  Checks"))
        print(self.dim("  " + "─" * self.width))
        self.print_checks(report)
        self.summary_block(report)
        print()


def emit_json(report: AuditReport, cfg: Config) -> str:
    payload = report_to_dict(report, redact=cfg.redact_output)
    payload["exit_code"] = report.exit_code
    payload["timings_ms"] = report.timings_ms
    payload["remediation_hints"] = report.remediation_hints
    return json.dumps(payload, indent=2)


def write_outputs(report: AuditReport, cfg: Config) -> int | None:
    if cfg.save_baseline:
        save_baseline(cfg.save_baseline, report)
    if cfg.output_file:
        with open(cfg.output_file, "w", encoding="utf-8") as fh:
            fh.write(emit_json(report, cfg))
            fh.write("\n")
    if cfg.compare_baseline:
        ok, msg = compare_to_baseline(report, cfg.compare_baseline)
        if not ok:
            print(msg, file=sys.stderr)
            return 3
    return None


def render_report(report: AuditReport, sec005: Sec005Config) -> None:
    cfg = sec005.http
    if cfg.quiet:
        return
    if cfg.output_format == "json":
        print(emit_json(report, cfg))
        return
    if cfg.output_format == "sarif":
        print(sarif_json(report))
        return
    AuditReporter(cfg, sec005).print_human(report)
