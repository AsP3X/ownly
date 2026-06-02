# Human: Baseline compare for audit JSON reports (prove remediation in CI).
# Agent: READS/WRITES JSON files; redacted fields only in saved baselines.

from __future__ import annotations

import json
from typing import Any

from .models import AuditReport
from .redact import redact_sensitive_text


def report_to_dict(report: AuditReport, *, redact: bool) -> dict[str, Any]:
    results = []
    for r in report.results:
        detail = r.detail
        if redact:
            detail = redact_sensitive_text(detail)
        results.append(
            {
                "name": r.name,
                "passed": r.passed,
                "severity": r.severity,
                "detail": detail,
                "evidence_key": r.evidence_key,
            }
        )
    evidence: dict[str, Any] = {}
    for key, ev in report.evidence.items():
        fields = ev.fields
        if redact:
            fields = {k: redact_sensitive_text(v) for k, v in fields.items()}
        evidence[key] = {
            "route": ev.route,
            "status": ev.status,
            "fields": fields,
        }
    return {
        "audit_id": report.audit_id,
        "target": report.target,
        "verdict": report.verdict,
        "setup_complete": report.setup_complete,
        "results": results,
        "evidence": evidence,
    }


def save_baseline(path: str, report: AuditReport) -> None:
    payload = report_to_dict(report, redact=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")


def load_baseline(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def compare_to_baseline(report: AuditReport, path: str) -> tuple[bool, str]:
    current = report_to_dict(report, redact=True)
    try:
        baseline = load_baseline(path)
    except OSError as exc:
        return False, f"cannot read baseline {path}: {exc}"
    if current == baseline:
        return True, "matches baseline"
    return False, "differs from baseline (remediation or regression)"
