# Human: Create and delete ephemeral admin subject for SEC-002 when only one admin exists.
# Agent: POST/DELETE /admin/users via demoter JWT; RETURNS credentials; no app imports.

from __future__ import annotations

import secrets

from .constants_sec002 import ROUTE_ADMIN_USERS
from .http_client import api_url, http_delete, http_post_json
from .models import HttpResult, Sec002Config


def generate_bootstrap_credentials() -> tuple[str, str]:
    # Human: Unique disposable admin used only for this audit run.
    # Agent: RETURNS email + password (password >= 8 chars for API validation).
    token = secrets.token_hex(4)
    email = f"sec002-audit-{token}@audit.local"
    password = secrets.token_urlsafe(18)
    return email, password


def create_bootstrap_subject(
    cfg: Sec002Config,
    demoter_token: str,
    *,
    email: str,
    password: str,
) -> tuple[str, HttpResult]:
    # Human: Demoter invites a temporary second admin (the demotion subject).
    # Agent: POST /admin/users; RETURNS (user_id, HttpResult).
    http = cfg.http
    url = api_url(http, ROUTE_ADMIN_USERS)
    res = http_post_json(
        http,
        url,
        {"email": email, "password": password, "role": "admin", "enabled": True},
        extra_headers={"Authorization": f"Bearer {demoter_token}"},
    )
    if res.error or res.status not in (200, 201):
        return "", res
    user_id = ""
    if isinstance(res.body_json, dict):
        raw_id = res.body_json.get("id")
        if isinstance(raw_id, str):
            user_id = raw_id.strip()
    return user_id, res


def delete_bootstrap_subject(cfg: Sec002Config, demoter_token: str, user_id: str) -> HttpResult:
    # Human: Remove ephemeral subject after the probe (best-effort).
    # Agent: DELETE /admin/users/{id}; RETURNS HttpResult.
    http = cfg.http
    url = api_url(http, f"{ROUTE_ADMIN_USERS}/{user_id}")
    return http_delete(
        http,
        url,
        extra_headers={"Authorization": f"Bearer {demoter_token}"},
    )
