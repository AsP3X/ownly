# Human: Detection helpers for SEC-011 zip archives including trashed files.
# Agent: READS HttpResult JSON; no HTTP; used by runner and unit tests.

from __future__ import annotations

from .heuristics import json_get
from .models import HttpResult

__all__ = [
    "zip_access_denied",
    "zip_job_started",
]


def zip_job_started(res: HttpResult) -> bool:
    # Human: True when bulk or folder zip job was accepted and queued.
    # Agent: CHECKS HTTP 200 and status/ready/job_id fields in zip response JSON.
    if res.status != 200 or res.body_json is None or not isinstance(res.body_json, dict):
        return False
    body = res.body_json
    status = body.get("status")
    if isinstance(status, str) and status in ("queued", "compressing", "processing", "ready"):
        return True
    if body.get("ready") is True:
        return True
    job_id = body.get("job_id")
    if isinstance(job_id, str) and job_id.strip():
        return True
    nested = json_get(body, "status")
    if isinstance(nested, str) and nested in ("queued", "compressing", "processing", "ready"):
        return True
    return False


def zip_access_denied(res: HttpResult) -> bool:
    return res.status in (400, 403, 404, 410)
