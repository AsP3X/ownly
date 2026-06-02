# Human: Redacted evidence for SEC-007 overview leak responses.
# Agent: BUILDS LeakEvidence without echoing share passwords.

from __future__ import annotations

from .heuristics_sec007 import overview_requires_password_flag, share_node_from_overview
from .models import HttpResult, LeakEvidence


def build_overview_evidence(
    res: HttpResult,
    *,
    route: str,
    title: str,
    had_password_header: bool,
) -> LeakEvidence:
    fields: dict[str, str] = {
        "http_status": str(res.status),
        "x_share_password": "yes" if had_password_header else "no",
    }
    share = share_node_from_overview(res)
    if share is not None:
        if overview_requires_password_flag(res):
            fields["requires_password"] = "true"
        email = share.get("shared_by_email")
        if isinstance(email, str) and email:
            fields["shared_by_email_present"] = "yes"
        name = share.get("name")
        if isinstance(name, str) and name:
            fields["resource_name_present"] = "yes"
        count = share.get("total_file_count")
        if count is not None:
            fields["total_file_count"] = str(count)
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)
