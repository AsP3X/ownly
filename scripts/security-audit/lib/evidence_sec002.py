# Human: Structured evidence for SEC-002 stale JWT admin access.
# Agent: READS HttpResult; RETURNS LeakEvidence without embedding raw JWT when redacted upstream.

from __future__ import annotations

from .constants_sec002 import DEFAULT_ADMIN_PROBE_ROUTE
from .models import HttpResult, LeakEvidence


def build_stale_admin_access_evidence(
    res: HttpResult,
    *,
    route: str = DEFAULT_ADMIN_PROBE_ROUTE,
    demoted_role: str,
) -> LeakEvidence:
    # Human: Capture HTTP status and summary fields proving post-demotion admin access.
    # Agent: WRITES LeakEvidence for report; tokens omitted from fields.
    fields: dict[str, str] = {
        "demoted_role": demoted_role,
        "http_status": str(res.status),
    }
    if res.body_json is not None and isinstance(res.body_json, dict):
        users = res.body_json.get("users")
        if isinstance(users, list):
            fields["users_count"] = str(len(users))
        summary = res.body_json.get("summary")
        if isinstance(summary, dict):
            admin_count = summary.get("admin_count")
            if admin_count is not None:
                fields["summary_admin_count"] = str(admin_count)
    elif res.body_text.strip():
        fields["raw_body_snippet"] = res.body_text.strip()[:240]
    return LeakEvidence(
        title="Stale JWT still grants admin API access after demotion",
        route=route,
        status=res.status,
        fields=fields,
    )
