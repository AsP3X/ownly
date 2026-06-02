# Human: Detection helpers for SEC-007 share overview password bypass.
# Agent: READS HttpResult JSON; no HTTP; used by runner and unit tests.

from __future__ import annotations

from typing import Any

from .heuristics import json_get
from .heuristics_sec003 import public_access_denied
from .models import HttpResult

__all__ = [
    "overview_metadata_leaked",
    "overview_requires_password_flag",
    "public_access_denied",
    "share_node_from_overview",
]


def share_node_from_overview(res: HttpResult) -> dict[str, Any] | None:
    # Human: Extract nested share object from overview JSON envelope.
    # Agent: READS body_json.share dict; RETURNS None when missing.
    if res.status != 200 or res.body_json is None or not isinstance(res.body_json, dict):
        return None
    share = res.body_json.get("share")
    if isinstance(share, dict):
        return share
    return None


def overview_requires_password_flag(res: HttpResult) -> bool:
    share = share_node_from_overview(res)
    if share is None:
        return False
    flag = json_get(share, "requires_password")
    return flag is True


def overview_metadata_leaked(res: HttpResult) -> bool:
    # Human: Vulnerable when overview returns owner email or resource stats without auth.
    # Agent: CHECKS HTTP 200 and sensitive share fields present — primary SEC-007 signal.
    share = share_node_from_overview(res)
    if share is None:
        return False
    email = json_get(share, "shared_by_email")
    if isinstance(email, str) and "@" in email:
        return True
    name = json_get(share, "name")
    total_files = json_get(share, "total_file_count")
    if isinstance(name, str) and name.strip() and total_files is not None:
        return True
    return False
