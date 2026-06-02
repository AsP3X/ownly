# Human: Detection helpers for SEC-004 authenticated access to trashed files.
# Agent: READS HttpResult JSON; no HTTP; used by runner and unit tests.

from __future__ import annotations

from .heuristics import json_get
from .heuristics_sec003 import public_download_grants_file
from .models import HttpResult

__all__ = [
    "authenticated_access_denied",
    "authenticated_download_grants_file",
    "json_url_issued",
]


def authenticated_download_grants_file(res: HttpResult) -> bool:
    # Human: Same byte-proxy signal as public share download (attachment or non-JSON body).
    # Agent: RETURNS True when GET /files/{id}/download still serves content.
    return public_download_grants_file(res)


def json_url_issued(res: HttpResult) -> bool:
    # Human: True when download-url or preview-url returns a usable URL JSON field.
    # Agent: CHECKS HTTP 200 and non-empty url string — SEC-004 presigned/preview signal.
    if res.status != 200 or res.body_json is None or not isinstance(res.body_json, dict):
        return False
    url = json_get(res.body_json, "url")
    return isinstance(url, str) and bool(url.strip())


def authenticated_access_denied(res: HttpResult) -> bool:
    return res.status in (401, 403, 404, 410)
