# Human: Detection helpers and JWT forgery for SEC-012 admin creation / escalation.
# Agent: READS HttpResult; stdlib HS256 forge; no HTTP in this module.

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from .heuristics import json_get
from .heuristics_sec002 import (
    extract_login_token,
    extract_login_user,
    response_indicates_admin_forbidden,
    response_indicates_admin_users_list,
)
from .heuristics_sec005 import bootstrap_token_enforced, setup_mutation_succeeded
from .models import HttpResult

__all__ = [
    "bootstrap_token_enforced",
    "extract_login_token",
    "extract_login_user",
    "extract_setup_auth",
    "forge_admin_jwt",
    "registration_enabled",
    "response_indicates_admin_forbidden",
    "response_indicates_admin_users_list",
    "setup_blocked_after_init",
    "setup_mutation_succeeded",
    "user_role_from_response",
]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def forge_admin_jwt(
    *,
    user_id: str,
    email: str,
    jwt_secret: str,
    session_version: int = 0,
    ttl_hours: int = 24,
) -> str:
    # Human: Build HS256 JWT matching backend Claims (sub, email, role, exp, iat, ver).
    # Agent: OMITS sid to use legacy session path; role=admin for require_admin bypass.
    now = int(time.time())
    payload = {
        "sub": user_id,
        "email": email,
        "role": "admin",
        "iat": now,
        "exp": now + ttl_hours * 3600,
        "ver": session_version,
    }
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}".encode()
    sig = hmac.new(jwt_secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url(sig)}"


def extract_setup_auth(res: HttpResult) -> dict[str, Any] | None:
    # Human: Normalize SetupResponse JSON (flat or nested auth object).
    # Agent: RETURNS dict with token + user when setup succeeded.
    if res.body_json is None or not isinstance(res.body_json, dict):
        return None
    body = res.body_json
    if isinstance(body.get("auth"), dict):
        return body["auth"]
    token = body.get("token")
    user = body.get("user")
    if isinstance(token, str) or isinstance(user, dict):
        return {"token": token, "user": user}
    return None


def user_role_from_response(res: HttpResult) -> str | None:
    user = extract_login_user(res)
    if user is None:
        auth = extract_setup_auth(res)
        if auth and isinstance(auth.get("user"), dict):
            user = auth["user"]
    if user is None and res.body_json is not None and isinstance(res.body_json, dict):
        nested = res.body_json.get("user")
        if isinstance(nested, dict):
            user = nested
    if not isinstance(user, dict):
        return None
    role = user.get("role")
    return role if isinstance(role, str) else None


def registration_enabled(res: HttpResult) -> bool | None:
    if res.body_json is None or not isinstance(res.body_json, dict):
        return None
    enabled = json_get(res.body_json, "enabled")
    if enabled is None:
        enabled = json_get(res.body_json, "allow_public_registration")
    if isinstance(enabled, bool):
        return enabled
    if isinstance(enabled, str):
        return enabled.strip().lower() == "true"
    return None


def setup_blocked_after_init(res: HttpResult) -> bool:
    if res.status == 409:
        return True
    return bootstrap_token_enforced(res)
