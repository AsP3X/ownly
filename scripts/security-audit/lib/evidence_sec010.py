# Human: Redacted evidence for SEC-010 database probe responses.
# Agent: BUILDS LeakEvidence; omits full database URLs from fields when redacting.

from __future__ import annotations

from .heuristics_sec010 import api_error_message
from .models import HttpResult, LeakEvidence


def build_database_probe_evidence(
    res: HttpResult,
    *,
    route: str,
    title: str,
    target_label: str,
) -> LeakEvidence:
    fields: dict[str, str] = {
        "http_status": str(res.status),
        "probe_target": target_label,
    }
    msg = api_error_message(res)
    if msg:
        fields["error_message"] = msg[:160]
    if res.body_json is not None and isinstance(res.body_json, dict) and res.body_json.get("ok") is True:
        fields["probe_ok"] = "true"
        driver = res.body_json.get("driver")
        if isinstance(driver, str):
            fields["driver"] = driver[:40]
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)
