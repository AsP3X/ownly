# Human: Structured evidence for SEC-011 zip job accepting trashed files.
# Agent: READS HttpResult; RETURNS LeakEvidence without archive paths in fields.

from __future__ import annotations

from .heuristics import json_get
from .models import HttpResult, LeakEvidence


def build_zip_evidence(
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
        status = json_get(res.body_json, "status")
        if isinstance(status, str):
            fields["job_status"] = status
        job_id = json_get(res.body_json, "job_id")
        if isinstance(job_id, str) and job_id.strip():
            fields["job_id"] = job_id[:36]
        archive = json_get(res.body_json, "archive_name")
        if isinstance(archive, str):
            fields["archive_name"] = archive[:80]
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)
