# Human: Structured evidence for SEC-012 successful admin creation / JWT escalation.
# Agent: READS HttpResult + exploit metadata; RETURNS LeakEvidence without raw secrets.

from __future__ import annotations

from .constants_sec012 import DEFAULT_ADMIN_PROBE_ROUTE
from .models import HttpResult, LeakEvidence


def build_setup_admin_evidence(
    res: HttpResult,
    *,
    email: str,
    user_id: str | None,
    route: str = "/setup",
) -> LeakEvidence:
    fields: dict[str, str] = {
        "exploit_chain": "setup_hijack",
        "attacker_email": email,
        "http_status": str(res.status),
    }
    if user_id:
        fields["created_user_id"] = user_id
    fields["db_role"] = "admin (hardcoded in setup INSERT)"
    return LeakEvidence(
        title="Unauthenticated setup created first administrator",
        route=route,
        status=res.status,
        fields=fields,
    )


def build_admin_api_evidence(
    res: HttpResult,
    *,
    route: str = DEFAULT_ADMIN_PROBE_ROUTE,
    via: str,
) -> LeakEvidence:
    fields: dict[str, str] = {
        "exploit_chain": via,
        "http_status": str(res.status),
    }
    if res.body_json is not None and isinstance(res.body_json, dict):
        users = res.body_json.get("users")
        if isinstance(users, list):
            fields["users_listed"] = str(len(users))
        summary = res.body_json.get("summary")
        if isinstance(summary, dict) and summary.get("admin_count") is not None:
            fields["summary_admin_count"] = str(summary["admin_count"])
    return LeakEvidence(
        title="Administrator API access confirmed after exploit",
        route=route,
        status=res.status,
        fields=fields,
    )


def build_jwt_forgery_evidence(
    res: HttpResult,
    *,
    subject_email: str,
    forged_role: str = "admin",
    route: str = DEFAULT_ADMIN_PROBE_ROUTE,
) -> LeakEvidence:
    return LeakEvidence(
        title="Forged JWT role claim grants admin API access",
        route=route,
        status=res.status,
        fields={
            "exploit_chain": "jwt_role_forgery",
            "subject_email": subject_email,
            "forged_role": forged_role,
            "http_status": str(res.status),
            "db_admin_row": "false (role only in JWT, not users table)",
        },
    )
