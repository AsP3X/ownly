# Human: Structured evidence for SEC-004 authenticated trash file access.
# Agent: READS HttpResult; RETURNS LeakEvidence without presigned URL secrets in fields.

from __future__ import annotations

from .heuristics import json_get
from .models import HttpResult, LeakEvidence


def build_endpoint_evidence(
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
    if res.body_json is not None and isinstance(res.body_json, dict):
        url = json_get(res.body_json, "url")
        if isinstance(url, str) and url.strip():
            fields["url_issued"] = "yes"
        expires = json_get(res.body_json, "expires_in_seconds")
        if expires is not None:
            fields["expires_in_seconds"] = str(expires)
    ct = res.headers.get("content-type", "")
    if ct:
        fields["content_type"] = ct
    disp = res.headers.get("content-disposition", "")
    if disp:
        fields["content_disposition"] = disp[:120]
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)
