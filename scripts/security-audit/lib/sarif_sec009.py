# Human: SARIF 2.1.0 export for SEC-009 findings (CI ingestion).
# Agent: WRITES minimal run from AuditReport failed checks only.

from __future__ import annotations

import json
from typing import Any

from .constants_sec009 import AUDIT_ID, REMEDIATION_SEC009
from .models import AuditReport


def report_to_sarif(report: AuditReport) -> dict[str, Any]:
    rules: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    for r in report.results:
        if r.passed or r.severity != "fail":
            continue
        rules.append(
            {
                "id": r.name,
                "name": r.name,
                "shortDescription": {"text": r.detail[:200]},
                "helpUri": "security-audit.md",
            }
        )
        results.append(
            {
                "ruleId": r.name,
                "level": "error",
                "message": {"text": r.detail},
                "locations": [
                    {"physicalLocation": {"artifactLocation": {"uri": report.target}}}
                ],
            }
        )
    return {
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": f"ownly-{AUDIT_ID.lower()}",
                        "informationUri": "security-audit.md",
                        "rules": rules,
                    }
                },
                "results": results,
                "invocations": [
                    {
                        "executionSuccessful": report.verdict == "ok",
                        "message": {
                            "text": REMEDIATION_SEC009 if report.verdict == "vulnerable" else "ok"
                        },
                    }
                ],
            }
        ],
    }


def sarif_json(report: AuditReport) -> str:
    return json.dumps(report_to_sarif(report), indent=2)
