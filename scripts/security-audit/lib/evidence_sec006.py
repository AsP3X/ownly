# Human: Redacted evidence for SEC-006 rate-limit probe batches.
# Agent: BUILDS LeakEvidence summarizing attempt counts without credentials.

from __future__ import annotations

from .heuristics_sec006 import count_rate_limited
from .models import HttpResult, LeakEvidence


def build_rate_limit_evidence(
    results: list[HttpResult],
    *,
    route: str,
    title: str,
    header_mode: str,
) -> LeakEvidence:
    # Human: Summarize how many attempts were throttled for the report evidence map.
    # Agent: RETURNS LeakEvidence; no passwords in fields.
    total = len(results)
    limited = count_rate_limited(results)
    last_status = results[-1].status if results else 0
    fields: dict[str, str] = {
        "attempts": str(total),
        "rate_limited_count": str(limited),
        "last_http_status": str(last_status),
        "header_mode": header_mode,
    }
    return LeakEvidence(title=title, route=route, status=last_status, fields=fields)
