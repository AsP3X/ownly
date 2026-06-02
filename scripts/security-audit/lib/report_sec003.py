# Human: Human-readable and JSON reporting for SEC-003 audits.
# Agent: WRITES stdout/files; respects quiet/json/sarif/redact flags.

from __future__ import annotations

import json
import os
import sys

from .compare import compare_to_baseline, report_to_dict, save_baseline
from .config_sec003 import loaded_env_file_path
from .constants_sec003 import (
    AUDIT_ID,
    CASE_LABELS,
    ROUTE_PUBLIC_ALL_FILES,
    ROUTE_PUBLIC_DOWNLOAD,
    ROUTE_SETUP_STATUS,
)
from .models import AuditReport, CaseResult, Config, LeakEvidence, Sec003Config
from .redact import redact_field_for_display
from .sarif_sec003 import sarif_json


class AuditReporter:
    def __init__(self, cfg: Config, sec003: Sec003Config) -> None:
        self.cfg = cfg
        self.sec003 = sec003
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

    def format_for_display(self, field_key: str, value: str) -> str:
        if not self.cfg.redact_output:
            return value
        return redact_field_for_display(field_key, value)

    def _heading(self, title: str) -> None:
        print()
        print(self.bold(f"  {title}"))
        print(self.dim("  " + "─" * self.width))

    def banner(self) -> None:
        title = f"{AUDIT_ID}  Public share soft-delete audit"
        inner = self.width - 2
        pad = max(0, inner - len(title) - 2)
        print()
        print(self.bold(f"╭{'─' * inner}╮"))
        print(self.bold(f"│ {title}{' ' * pad} │"))
        print(self.bold(f"╰{'─' * inner}╯"))
        print()
        print(f"  {'Target':<12} {self.cfg.base_url}{self.cfg.api_prefix}")
        env_src = loaded_env_file_path()
        if env_src:
            print(f"  {'Env file':<12} {self.dim(str(env_src))}  {self.dim('(SEC003_* only)')}")
        print(
            f"  {'Attack':<12} {self.dim('folder share → trash file → anonymous public GET')}"
        )
        print(
            f"  {'Probes':<12} GET {ROUTE_PUBLIC_ALL_FILES} · GET {ROUTE_PUBLIC_DOWNLOAD}"
        )
        owner = self.sec003.owner_email or self.dim("(not set — SEC003_OWNER_EMAIL)")
        print(f"  {'Owner':<12} {owner}")
        boot = "yes" if self.sec003.bootstrap_fixtures else "no (--no-bootstrap)"
        print(f"  {'Bootstrap':<12} {boot}")
        restore = "yes" if self.sec003.restore_after_probe else "no (--no-restore)"
        print(f"  {'Restore':<12} {restore}")

    def status_icon(self, result: CaseResult) -> str:
        if result.passed:
            return self.green("✓")
        if result.severity == "error":
            return self.yellow("!")
        return self.red("✗")

    def print_checks(self, report: AuditReport) -> None:
        for result in report.results:
            label = CASE_LABELS.get(result.name, result.name.replace("_", " "))
            icon = self.status_icon(result)
            line = f"  {icon}  {label}"
            if not result.passed:
                line += self.dim(f"  —  {self.format_for_display('detail', result.detail)}")
            print(line)

    def context_block(self, report: AuditReport) -> None:
        self._heading("Instance")
        c = report.setup_complete
        if c is True:
            print(f"  setup_complete   {self.yellow('true')}")
        elif c is False:
            print(f"  setup_complete   {self.green('false')}")
        else:
            print(f"  setup_complete   {self.dim('unknown')}")
        print(f"  setup probe      GET {ROUTE_SETUP_STATUS}")

    def evidence_block(self, report: AuditReport) -> None:
        if not self.cfg.show_leaks or not report.evidence:
            return
        self._heading("Exploit evidence")
        print(self.dim("  Share tokens redacted in output."))
        for ev in report.evidence.values():
            route = f"{self.cfg.api_prefix}{ev.route}"
            print(self.bold(f"  ▶  {route}"))
            print(self.dim(f"     {ev.title} · HTTP {ev.status}"))
            for key, value in ev.fields.items():
                print(f"     {key}: {self.format_for_display(key, value)}")
            print()

    def summary_block(self, report: AuditReport) -> None:
        fails = [r for r in report.results if not r.passed and r.severity == "fail"]
        errors = [r for r in report.results if not r.passed and r.severity == "error"]
        passes = [r for r in report.results if r.passed]
        self._heading("Summary")
        print(f"  {self.green('Passed'):<10} {len(passes)}")
        print(f"  {self.red('Failed'):<10} {len(fails)}")
        print(f"  {self.yellow('Errors'):<10} {len(errors)}")
        if fails and self.cfg.show_leaks:
            self.evidence_block(report)
        if report.remediation_hints:
            self._heading("Remediation")
            for hint in report.remediation_hints:
                print(f"  • {hint}")
        self._heading("Verdict")
        if report.verdict == "vulnerable":
            print(f"  {self.red('✗  VULNERABLE')}")
            print(self.dim("     See security-audit.md → SEC-003"))
        elif report.verdict == "inconclusive":
            print(f"  {self.yellow('?  INCONCLUSIVE')}")
        else:
            print(f"  {self.green('✓  OK')}")

    def print_human(self, report: AuditReport) -> None:
        self.banner()
        self.context_block(report)
        self._heading("Checks")
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


def render_report(report: AuditReport, sec003: Sec003Config) -> None:
    cfg = sec003.http
    if cfg.quiet:
        return
    if cfg.output_format == "json":
        print(emit_json(report, cfg))
        return
    if cfg.output_format == "sarif":
        print(sarif_json(report))
        return
    AuditReporter(cfg, sec003).print_human(report)
