# Human: Detection helpers for SEC-008 setup storage SSRF / internal probe.
# Agent: READS HttpResult; no HTTP; used by runner and unit tests.

from __future__ import annotations

import re

from .models import HttpResult

__all__ = [
    "api_error_message",
    "private_address_rejected",
    "ssrf_probe_vulnerable",
    "storage_test_auth_required",
    "storage_test_setup_complete_block",
    "unauthenticated_storage_probe_accepted",
]

_PRIVATE_REJECT = re.compile(
    r"private|localhost|127\.0\.0\.1|link[- ]?local|reserved|"
    r"not allowed|blocked|internal|metadata|ssrf|rfc1918",
    re.IGNORECASE,
)

_REACH_FAILURE = re.compile(
    r"could not reach|unreachable|connection refused|timeout",
    re.IGNORECASE,
)


def api_error_message(res: HttpResult) -> str:
    if res.body_json is None or not isinstance(res.body_json, dict):
        return res.body_text
    err = res.body_json.get("error")
    if isinstance(err, dict):
        msg = err.get("message")
        if isinstance(msg, str):
            return msg
    return res.body_text


def storage_test_auth_required(res: HttpResult) -> bool:
    return res.status in (401, 403)


def storage_test_setup_complete_block(res: HttpResult) -> bool:
    if res.status == 409:
        return True
    return res.status == 400 and "setup already completed" in api_error_message(res).lower()


def private_address_rejected(res: HttpResult) -> bool:
    # Human: Server refused internal target before (or instead of) blind SSRF fetch.
    # Agent: MATCHES validation error text on HTTP 400/403.
    if res.status not in (400, 403):
        return False
    return bool(_PRIVATE_REJECT.search(api_error_message(res)))


def unauthenticated_storage_probe_accepted(res: HttpResult) -> bool:
    # Human: Endpoint processed a storage test request without bootstrap auth.
    # Agent: RETURNS True for 200 probe result or 400 reach failure (outbound attempt).
    if storage_test_auth_required(res) or storage_test_setup_complete_block(res):
        return False
    if res.status == 200 and res.body_json is not None:
        return True
    if res.status == 400 and _REACH_FAILURE.search(api_error_message(res)):
        return True
    if res.status == 400 and not private_address_rejected(res):
        msg = api_error_message(res).lower()
        if "http://" in msg or "https://" in msg or "storage" in msg or "endpoint" in msg:
            return True
    return False


def ssrf_probe_vulnerable(res: HttpResult) -> bool:
    return unauthenticated_storage_probe_accepted(res) and not private_address_rejected(res)
