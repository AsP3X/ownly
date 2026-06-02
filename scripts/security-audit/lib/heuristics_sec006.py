# Human: Detection helpers for SEC-006 rate-limit header spoofing.
# Agent: READS HttpResult; no HTTP; used by runner and unit tests.

from __future__ import annotations

from .models import HttpResult

__all__ = [
    "count_rate_limited",
    "header_rotation_bypasses_limit",
    "is_rate_limited",
    "single_key_enforces_limit",
]


def is_rate_limited(res: HttpResult) -> bool:
    # Human: True when the API applied the per-key rate limiter.
    # Agent: CHECKS HTTP 429 or error.code rate_limited in JSON envelope.
    if res.status == 429:
        return True
    if res.body_json is None or not isinstance(res.body_json, dict):
        return False
    err = res.body_json.get("error")
    if isinstance(err, dict):
        code = err.get("code")
        if isinstance(code, str) and code.strip().lower() == "rate_limited":
            return True
    return False


def count_rate_limited(results: list[HttpResult]) -> int:
    return sum(1 for res in results if is_rate_limited(res))


def single_key_enforces_limit(results: list[HttpResult], *, min_hits: int = 1) -> bool:
    # Human: Fixed spoofed IP eventually triggers throttling.
    # Agent: RETURNS True when at least min_hits responses are rate-limited.
    return count_rate_limited(results) >= min_hits


def header_rotation_bypasses_limit(
    fixed_results: list[HttpResult],
    rotated_results: list[HttpResult],
) -> bool:
    # Human: Vulnerable when rotation eliminates throttling that fixed IP triggered.
    # Agent: COMPARES rate_limited counts — bypass if fixed hit limit and rotated did not.
    fixed_hits = count_rate_limited(fixed_results)
    rotated_hits = count_rate_limited(rotated_results)
    if fixed_hits < 1:
        return False
    return rotated_hits < fixed_hits
