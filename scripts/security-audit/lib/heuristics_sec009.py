# Human: Detection helpers for SEC-009 share password brute-force throttling.
# Agent: READS HttpResult; no HTTP; used by runner and unit tests.

from __future__ import annotations

import re

from .heuristics_sec006 import is_rate_limited
from .models import HttpResult

__all__ = [
    "brute_force_unthrottled",
    "count_forbidden_wrong_password",
    "count_rate_limited",
    "is_rate_limited",
    "missing_share_password",
    "public_contents_granted",
    "wrong_share_password_rejected",
]

_INCORRECT_PASSWORD = re.compile(r"incorrect share password", re.IGNORECASE)
_REQUIRES_PASSWORD = re.compile(r"requires a password", re.IGNORECASE)


def _error_message(res: HttpResult) -> str:
    if res.body_json is None or not isinstance(res.body_json, dict):
        return res.body_text
    err = res.body_json.get("error")
    if isinstance(err, dict):
        msg = err.get("message")
        if isinstance(msg, str):
            return msg
    return res.body_text


def wrong_share_password_rejected(res: HttpResult) -> bool:
    # Human: verify_share_password returned Forbidden for a bad guess.
    # Agent: CHECKS HTTP 403 and incorrect-password message.
    if res.status != 403:
        return False
    return bool(_INCORRECT_PASSWORD.search(_error_message(res)))


def missing_share_password(res: HttpResult) -> bool:
    if res.status != 403:
        return False
    return bool(_REQUIRES_PASSWORD.search(_error_message(res)))


def public_contents_granted(res: HttpResult) -> bool:
    # Human: Password accepted — folder listing JSON returned.
    # Agent: CHECKS HTTP 200 with JSON body on /contents.
    return res.status == 200 and res.body_json is not None


def count_forbidden_wrong_password(results: list[HttpResult]) -> int:
    return sum(1 for res in results if wrong_share_password_rejected(res))


def count_rate_limited(results: list[HttpResult]) -> int:
    return sum(1 for res in results if is_rate_limited(res))


def brute_force_unthrottled(
    results: list[HttpResult],
    *,
    min_forbidden: int = 8,
) -> bool:
    # Human: Vulnerable when many wrong-password 403s occur with zero 429 responses.
    # Agent: RETURNS True when throttling/lockout is absent across the burst.
    forbidden = count_forbidden_wrong_password(results)
    limited = count_rate_limited(results)
    if forbidden < min_forbidden:
        return False
    return limited == 0
