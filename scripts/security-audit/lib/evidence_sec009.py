# Human: Redacted evidence for SEC-009 password-guess burst probes.
# Agent: BUILDS LeakEvidence; does not echo guessed passwords in fields.

from __future__ import annotations

from .heuristics_sec009 import count_forbidden_wrong_password, count_rate_limited
from .models import HttpResult, LeakEvidence


def build_burst_evidence(
    results: list[HttpResult],
    *,
    route: str,
    title: str,
    mode: str,
) -> LeakEvidence:
    last = results[-1] if results else HttpResult(0, {}, "", None)
    fields: dict[str, str] = {
        "attempts": str(len(results)),
        "forbidden_wrong_password": str(count_forbidden_wrong_password(results)),
        "rate_limited": str(count_rate_limited(results)),
        "probe_mode": mode,
    }
    return LeakEvidence(title=title, route=route, status=last.status, fields=fields)
