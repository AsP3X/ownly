# Human: Human-readable and JSON reporting for SEC-002 audits.
# Agent: WRITES stdout/files; respects quiet/json/sarif/compact/redact flags.

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .compare import compare_to_baseline, report_to_dict, save_baseline
from .config_sec002 import loaded_env_file_path
from .constants_sec002 import AUDIT_ID, CASE_LABELS, ROUTE_AUTH_LOGIN, ROUTE_SETUP_STATUS
from .models import AuditReport, CaseResult, Config, LeakEvidence, Sec002Config
from .redact import redact_field_for_display, redact_sensitive_text
from .sarif_sec002 import sarif_json


class AuditReporter:
    def __init__(self, cfg: Config, sec002: Sec002Config) -> None:
        self.cfg = cfg
        self.sec002 = sec002
        self.use_color = self._color_enabled()
        self.width = 72

    def _color_enabled(self) -> bool:
        if os.environ.get("NO_COLOR", "").strip():
            return False
        if os.environ.get("SEC002_NO_COLOR", "").strip().lower() in ("1", "true", "yes"):
            return False
        return sys.stdout.isatty()

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
        title = f"{AUDIT_ID}  Stale JWT admin role audit"
        inner = self.width - 2
        pad = max(0, inner - len(title) - 2)
        print()
        print(self.bold(f"╭{'─' * inner}╮"))
        print(self.bold(f"│ {title}{' ' * pad} │"))
        print(self.bold(f"╰{'─' * inner}╯"))
        print()
        print(f"  {'Target':<12} {self.cfg.base_url}{self.cfg.api_prefix}")
        env_src = loaded_env_file_path()
        if env_src is not None:
            print(f"  {'Env file':<12} {self.dim(str(env_src))}  {self.dim('(SEC002_* only)')}")
        print(
            f"  {'Attack':<12} {self.dim('login → demote → reuse pre-demotion JWT on admin route')}"
        )
        print(
            f"  {'Probes':<12} POST {ROUTE_AUTH_LOGIN} · PATCH admin user · GET {self.sec002.admin_probe_route}"
        )
        subject = self.sec002.subject_email or self.dim("(not set — SEC002_SUBJECT_EMAIL)")
        demoter = self.sec002.demoter_email or self.dim("(not set — SEC002_DEMOTER_EMAIL)")
        print(f"  {'Subject':<12} {subject}  → demote to {self.sec002.demote_role!r}")
        print(f"  {'Demoter':<12} {demoter}")
        if self.sec002.bootstrap_subject:
            print(f"  {'Bootstrap':<12} {self.dim('temporary subject admin via demoter')}")
        else:
            restore = "yes" if self.sec002.restore_admin_role else "no (--no-restore)"
            print(f"  {'Restore':<12} {restore}")
        print(
            f"  {'Timeout':<12} {self.cfg.timeout_sec}s · retries {self.cfg.retries}"
            f" · TLS {'off' if self.cfg.insecure_tls else 'on'}"
        )
        if self.cfg.redact_output:
            print(f"  {'Output':<12} {self.dim('redacted JWTs (use --no-redaction for raw)')}")
        else:
            print(f"  {'Output':<12} {self.yellow('raw JWTs (--no-redaction)')}")

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
                detail = self.format_for_display("detail", result.detail)
                line += self.dim(f"  —  {detail}")
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

    def timings_block(self, report: AuditReport) -> None:
        if not self.cfg.verbose or not report.timings_ms:
            return
        self._heading("Timings (ms)")
        for key, ms in sorted(report.timings_ms.items()):
            print(f"  {key:<22} {ms}")

    def evidence_block(self, report: AuditReport) -> None:
        if not self.cfg.show_leaks or not report.evidence:
            return
        self._heading("Exploit evidence")
        if self.cfg.redact_output:
            print(self.dim("  JWTs and secrets redacted. Use --no-redaction for raw values."))
        print()
        for ev in report.evidence.values():
            self._print_endpoint_evidence(ev)

    def _print_endpoint_evidence(self, ev: LeakEvidence) -> None:
        route = f"{self.cfg.api_prefix}{ev.route}"
        print(self.bold(f"  ▶  GET {route}"))
        print(self.dim(f"     {ev.title} · HTTP {ev.status}"))
        if not ev.fields:
            print(self.dim("     (empty body)"))
            print()
            return
        kw = max(len(k) for k in ev.fields)
        for key, value in ev.fields.items():
            display = self.format_for_display(key, value)
            dots = "." * max(1, 24 - kw)
            print(f"     {self.dim(f'{key:<{kw}}')} {dots}  {display}")
        print()

    def remediation_block(self, report: AuditReport) -> None:
        if not report.remediation_hints:
            return
        self._heading("Remediation")
        for hint in report.remediation_hints:
            print(f"  • {hint}")

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
        self.remediation_block(report)
        self._heading("Verdict")
        if report.verdict == "vulnerable":
            print(f"  {self.red('✗  VULNERABLE')}")
            print(self.dim("     See security-audit.md → SEC-002"))
        elif report.verdict == "inconclusive":
            print(f"  {self.yellow('?  INCONCLUSIVE')}")
            missing_cred = any(
                r.name == "credentials_configured" and not r.passed for r in report.results
            )
            if missing_cred:
                print(self.dim("     Set SEC002_SUBJECT_* and SEC002_DEMOTER_* (two admin accounts)."))
                print(self.dim("     See scripts/security-audit/README.md → SEC-002"))
        else:
            print(f"  {self.green('✓  OK')}")

    def print_human(self, report: AuditReport) -> None:
        self.banner()
        self.context_block(report)
        self._heading("Checks")
        self.print_checks(report)
        self.timings_block(report)
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
        text = emit_json(report, cfg)
        with open(cfg.output_file, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.write("\n")
    if cfg.compare_baseline:
        ok, msg = compare_to_baseline(report, cfg.compare_baseline)
        if not ok:
            print(msg, file=sys.stderr)
            return 3
    return None


def render_report(report: AuditReport, sec002: Sec002Config) -> None:
    cfg = sec002.http
    if cfg.quiet:
        return
    if cfg.output_format == "json":
        print(emit_json(report, cfg))
        return
    if cfg.output_format == "sarif":
        print(sarif_json(report))
        return
    AuditReporter(cfg, sec002).print_human(report)
