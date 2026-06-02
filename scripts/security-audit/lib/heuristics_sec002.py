# Human: Detection helpers for SEC-002 admin access after JWT role demotion.
# Agent: READS HttpResult JSON; no HTTP; used by runner and unit tests.

from __future__ import annotations

from typing import Any

from .heuristics import json_get
from .models import HttpResult


def extract_login_token(res: HttpResult) -> str | None:
    # Human: Pull bearer token from auth.login JSON body.
    # Agent: RETURNS token string or None when missing or non-JSON.
    if res.body_json is None or not isinstance(res.body_json, dict):
        return None
    token = res.body_json.get("token")
    if isinstance(token, str) and token.strip():
        return token.strip()
    return None


def extract_login_user(res: HttpResult) -> dict[str, Any] | None:
    if res.body_json is None or not isinstance(res.body_json, dict):
        return None
    user = res.body_json.get("user")
    if isinstance(user, dict):
        return user
    return None


def response_indicates_admin_users_list(res: HttpResult) -> bool:
    # Human: True when GET /admin/users returns the expected admin directory payload.
    # Agent: CHECKS HTTP 200 and users array — primary SEC-002 vulnerability signal.
    if res.status != 200 or res.body_json is None or not isinstance(res.body_json, dict):
        return False
    users = res.body_json.get("users")
    return isinstance(users, list)


def response_indicates_admin_forbidden(res: HttpResult) -> bool:
    return res.status in (401, 403)


def find_user_id_by_email(body_json: Any, email: str) -> str | None:
    # Human: Locate a user id in GET /admin/users list for PATCH demotion.
    # Agent: READS users[].email; RETURNS id or None.
    if body_json is None or not isinstance(body_json, dict):
        return None
    users = body_json.get("users")
    if not isinstance(users, list):
        return None
    needle = email.strip().lower()
    for row in users:
        if not isinstance(row, dict):
            continue
        row_email = row.get("email")
        row_id = row.get("id")
        if (
            isinstance(row_email, str)
            and row_email.strip().lower() == needle
            and isinstance(row_id, str)
            and row_id.strip()
        ):
            return row_id.strip()
    return None


def login_user_role(res: HttpResult) -> str | None:
    user = extract_login_user(res)
    if user is None:
        return None
    role = user.get("role")
    return role if isinstance(role, str) else None


def login_user_id(res: HttpResult) -> str | None:
    user = extract_login_user(res)
    if user is None:
        return None
    uid = user.get("id")
    return uid if isinstance(uid, str) and uid.strip() else None


def patch_confirmed_role(body_json: Any, expected_role: str) -> bool:
    if body_json is None or not isinstance(body_json, dict):
        return False
    role = json_get(body_json, "role")
    return isinstance(role, str) and role == expected_role
