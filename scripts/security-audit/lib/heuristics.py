# Human: Vulnerability detection heuristics for SEC-001 (independent of display redaction).
# Agent: REGEX scans; strict mode adds checks; permissive is default.

from __future__ import annotations

import re
from typing import Any

from .redact import looks_redacted

CREDENTIAL_URL_SCHEMES = re.compile(
    r"(?i)(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp)://[^\s\"']+",
)
USER_PASS_IN_AUTHORITY = re.compile(
    r"(?i)(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis)://[^:]+:[^@/]+@",
)
GENERIC_USER_PASS_AT = re.compile(r"://[^/\s\"']+:[^@\s\"']+@[^\s\"']+")
PASSWORD_QUERY_PARAM = re.compile(r"(?i)[?&]password=[^&\s\"']+")
SECRET_JSON_KEYS = re.compile(
    r"(?i)\"(?:password|passwd|secret|api[_-]?key|access[_-]?key|secret[_-]?key)\"\s*:\s*\"[^\"]{3,}\"",
)

STORAGE_SENSITIVE_KEYS = (
    "object_storage_url",
    "object_storage_public_url",
    "object_storage_bucket",
    "storage_mode",
)


def is_blocked_status(status: int) -> bool:
    return status in (401, 403, 404, 405, 410, 451)


def json_get(obj: Any, key: str) -> Any | None:
    if isinstance(obj, dict):
        return obj.get(key)
    return None


def body_contains_credential_material(text: str, *, strict: bool = False) -> list[str]:
    findings: list[str] = []
    if not text:
        return findings
    checks: list[tuple[str, re.Pattern[str]]] = [
        ("connection URL with scheme", CREDENTIAL_URL_SCHEMES),
        ("user:password in URL authority", USER_PASS_IN_AUTHORITY),
        ("generic user:pass@ host pattern", GENERIC_USER_PASS_AT),
        ("password query parameter", PASSWORD_QUERY_PARAM),
        ("sensitive JSON key with value", SECRET_JSON_KEYS),
    ]
    if strict:
        checks.append(
            ("@ in connection-like string", re.compile(r"://[^\s\"']+@[^\s\"']+")),
        )
    for label, pattern in checks:
        if pattern.search(text):
            findings.append(label)
    return findings


def database_response_is_fixed(body_json: Any | None, body_text: str) -> bool:
    # Human: Matches remediated API — blocked is handled separately; here 200 with safe shape.
    # Agent: True when no database_url or redacted/empty URL and no credential heuristics in body.
    if body_contains_credential_material(body_text):
        return False
    if body_json is None or not isinstance(body_json, dict):
        return not body_text.strip()
    db_url = json_get(body_json, "database_url")
    if db_url is None:
        return True
    if not isinstance(db_url, str) or not db_url.strip():
        return True
    return looks_redacted(db_url)


def storage_response_is_fixed(body_json: Any | None) -> bool:
    if body_json is None or not isinstance(body_json, dict):
        return True
    for key in STORAGE_SENSITIVE_KEYS:
        val = json_get(body_json, key)
        if isinstance(val, str) and val.strip() and not looks_redacted(val):
            return False
    return True


def storage_exposed_keys(body_json: Any | None) -> list[str]:
    exposed: list[str] = []
    if body_json is None or not isinstance(body_json, dict):
        return exposed
    for key in STORAGE_SENSITIVE_KEYS:
        val = json_get(body_json, key)
        if isinstance(val, str) and val.strip() and not looks_redacted(val):
            exposed.append(key)
    return exposed
