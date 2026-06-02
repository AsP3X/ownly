# Human: Structured evidence for SEC-003 public share data exposure.
# Agent: READS HttpResult; RETURNS LeakEvidence without raw file bytes in fields.

from __future__ import annotations

from .heuristics_sec003 import _iter_file_ids
from .models import HttpResult, LeakEvidence


def build_public_leak_evidence(
    res: HttpResult,
    *,
    route: str,
    file_id: str,
    title: str,
) -> LeakEvidence:
    fields: dict[str, str] = {
        "file_id": file_id,
        "http_status": str(res.status),
    }
    ids = _iter_file_ids(res.body_json)
    if ids:
        fields["visible_file_ids"] = ", ".join(ids[:8])
        if len(ids) > 8:
            fields["visible_file_ids"] += f" … (+{len(ids) - 8} more)"
    ct = res.headers.get("content-type", "")
    if ct:
        fields["content_type"] = ct
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)
