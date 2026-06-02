# Human: Redacted evidence blocks for SEC-005 setup probe responses.
# Agent: BUILDS LeakEvidence from HttpResult; no secrets from probe body.

from __future__ import annotations

from .models import HttpResult, LeakEvidence


def build_setup_probe_evidence(res: HttpResult, *, route: str, title: str) -> LeakEvidence:
    # Human: Capture status and safe error snippet for report evidence map.
    # Agent: RETURNS LeakEvidence; WRITES no probe passwords in fields.
    fields: dict[str, str] = {
        "http_status": str(res.status),
        "auth": "none",
    }
    if res.body_json and isinstance(res.body_json, dict):
        err = res.body_json.get("error")
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            fields["error_message"] = err["message"][:120]
        code = err.get("code") if isinstance(err, dict) else None
        if isinstance(code, str):
            fields["error_code"] = code
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)
