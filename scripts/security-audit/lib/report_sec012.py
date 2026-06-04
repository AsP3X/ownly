# Human: Human-readable and JSON reporting for SEC-012 live exploit audits.
# Agent: WRITES stdout/files; includes exploit analysis block; respects redact flags.

from __future__ import annotations

import json
import os
import sys

from .compare import compare_to_baseline, report_to_dict, save_baseline
from .config_sec012 import loaded_env_file_path
from .constants_sec012 import (
    AUDIT_ID,
    CASE_LABELS,
    EXPLOIT_ANALYSIS_JWT,
    EXPLOIT_ANALYSIS_SETUP,
    ROUTE_SETUP,
)
from .models import AuditReport, CaseResult, Config, LeakEvidence, Sec012Config
from .redact import redact_field_for_display
from .sarif_sec012 import sarif_json


class AuditReporter:
    def __init__(self, cfg: Config, sec012: Sec012Config, cache: dict) -> None:
        self.cfg = cfg
        self.sec012 = sec012
        self.cache = cache
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
        title = f"{AUDIT_ID}  Unauthenticated admin creation exploit"
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
        mode = (
            self.red("LIVE EXPLOIT")
            if self.sec012.confirm_exploit
            else self.yellow("DRY-RUN (no --confirm-exploit)")
        )
        print(f"  {'Mode':<12} {mode}")
        print(
            f"  {'Chain A':<12} {self.dim(f'unauthenticated POST {ROUTE_SETUP} on empty users table')}"
        )
        if self.sec012.try_jwt_forgery:
            n = len(self.sec012.jwt_secrets)
            boot = (
                "; admin→pro bootstrap on"
                if self.sec012.bootstrap_via_admin
                else ""
            )
            print(
                f"  {'Chain B':<12} {self.dim(f'JWT re-sign + POST /admin/users ({n} secret(s){boot})')}"
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
            if result.passed and result.detail.lower().startswith("skipped"):
                print(f"  {self.dim('-')}  {label}{self.dim('  (skipped)')}")
                continue
            line = f"  {self.status_icon(result)}  {label}"
            if not result.passed:
                line += self.dim(
                    f"  —  {redact_field_for_display('detail', result.detail)}"
                )
            print(line)

    def analysis_block(self) -> None:
        print()
        print(self.bold("  Exploit analysis"))
        print(self.dim("  " + "─" * self.width))
        print(f"  {self.dim('1.')} {EXPLOIT_ANALYSIS_SETUP}")
        print()
        print(f"  {self.dim('2.')} {EXPLOIT_ANALYSIS_JWT}")
        print()
        print(
            self.dim(
                "  Register → admin: blocked server-side (role=user). Escalation requires "
                "setup hijack or JWT forgery / stale admin token (SEC-002)."
            )
        )
        if self.cache.get("exploit_email") and self.sec012.confirm_exploit:
            email = redact_field_for_display("email", self.cache["exploit_email"])
            print()
            print(f"  {'Attacker':<12} {email}")

    def evidence_block(self, report: AuditReport) -> None:
        if not self.cfg.show_leaks or not report.evidence:
            return
        print()
        print(self.bold("  Exploit evidence"))
        if self.cfg.redact_output:
            print(self.dim("  Tokens and passwords redacted. Use --no-redaction for raw values."))
        print()
        for ev in report.evidence.values():
            self._print_evidence(ev)

    def _print_evidence(self, ev: LeakEvidence) -> None:
        route = f"{self.cfg.api_prefix}{ev.route}"
        print(self.bold(f"  ▶  {ev.title}"))
        print(self.dim(f"     {route} · HTTP {ev.status}"))
        if not ev.fields:
            print()
            return
        kw = max(len(k) for k in ev.fields)
        for key, value in ev.fields.items():
            display = redact_field_for_display(key, value)
            dots = "." * max(1, 24 - kw)
            print(f"     {self.dim(f'{key:<{kw}}')} {dots}  {display}")
        print()

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
        if fails and self.cfg.show_leaks:
            self.evidence_block(report)
        if report.remediation_hints:
            print()
            print(self.bold("  Remediation"))
            for hint in report.remediation_hints:
                print(f"  • {hint}")
        print()
        print(self.bold("  Verdict"))
        if report.verdict == "vulnerable":
            print(f"  {self.red('✗  VULNERABLE — administrator account created or admin API reached')}")
            print(self.dim("     See security-audit.md → SEC-012"))
        elif report.verdict == "inconclusive":
            print(f"  {self.yellow('?  INCONCLUSIVE')}")
            if not self.sec012.confirm_exploit:
                print(
                    self.dim(
                        "     Pass --confirm-exploit to run the live setup hijack "
                        "(requires setup_complete=false and reachable storage)."
                    )
                )
        else:
            print(f"  {self.green('✓  OK — exploit chains blocked')}")


def render_report(report: AuditReport, cfg: Sec012Config, cache: dict) -> None:
    if cfg.http.quiet:
        return
    reporter = AuditReporter(cfg.http, cfg, cache)
    if cfg.http.output_format == "human":
        reporter.banner()
        reporter.analysis_block()
        print()
        print(reporter.bold("  Checks"))
        reporter.print_checks(report)
        reporter.summary_block(report)
        print()


def write_outputs(report: AuditReport, cfg: Sec012Config) -> int | None:
    http = cfg.http
    if http.save_baseline:
        save_baseline(http.save_baseline, report)
    if http.output_file:
        payload = report_to_dict(report, redact=http.redact_output)
        payload["exit_code"] = report.exit_code
        payload["timings_ms"] = report.timings_ms
        payload["remediation_hints"] = report.remediation_hints
        with open(http.output_file, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
    if http.compare_baseline:
        return compare_to_baseline(http.compare_baseline, report)
    if http.output_format == "json":
        payload = report_to_dict(report, redact=http.redact_output)
        payload["exit_code"] = report.exit_code
        print(json.dumps(payload, indent=2))
    elif http.output_format == "sarif":
        print(sarif_json(report))
    return None


def emit_json(report: AuditReport, cfg: Config) -> str:
    payload = report_to_dict(report, redact=cfg.redact_output)
    payload["exit_code"] = report.exit_code
    return json.dumps(payload, indent=2)
