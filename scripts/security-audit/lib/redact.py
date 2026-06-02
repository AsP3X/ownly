# Human: Default stdout sanitization for security audit scripts.
# Agent: regex-only; used when Config.redact_output is True.

from __future__ import annotations

import re

PASSWORD_QUERY_PARAM = re.compile(r"(?i)[?&]password=[^&\s\"']+")

URL_AUTHORITY_USERINFO = re.compile(
    r"([a-z][a-z0-9+.-]*://)([^/\s\"'@]+)@",
    re.IGNORECASE,
)

SENSITIVE_QUERY_PARAMS = re.compile(
    r"([?&](?:password|passwd|secret|access_key|secret_key|api_key|token)=)[^&\s\"']+",
    re.IGNORECASE,
)

SECRET_JSON_KV = re.compile(
    r'("(?:password|passwd|secret|api[_-]?key|access[_-]?key|secret[_-]?key|token)")\s*:\s*"([^"]*)"',
    re.IGNORECASE,
)

REDACTION_MARKERS = re.compile(
    r"(?i)(\[redacted\]|\*\*\*|••••|<redacted>|__REDACTED__|REDACTED)",
)


def _redact_url_authority(match: re.Match[str]) -> str:
    prefix = match.group(1)
    userinfo = match.group(2)
    if ":" in userinfo:
        user = userinfo.split(":", 1)[0]
        return f"{prefix}{user}:***@"
    if userinfo in ("***", ""):
        return match.group(0)
    return f"{prefix}***@"


def redact_sensitive_text(text: str) -> str:
    # Human: Mask credentials anywhere in printed audit output.
    # Agent: CALLS regex subs; skipped when --no-redaction is set.
    if not text:
        return text
    out = URL_AUTHORITY_USERINFO.sub(_redact_url_authority, text)
    out = SENSITIVE_QUERY_PARAMS.sub(r"\1***", out)
    out = PASSWORD_QUERY_PARAM.sub("password=***", out)
    out = SECRET_JSON_KV.sub(r'\1: "***"', out)
    return out


def redact_field_for_display(field_key: str, value: str) -> str:
    _ = field_key
    return redact_sensitive_text(value)


def looks_redacted(value: str) -> bool:
    if not value or not value.strip():
        return True
    if REDACTION_MARKERS.search(value):
        return True
    if value.strip().lower() in ("", "null", "none", "n/a"):
        return True
    return False
