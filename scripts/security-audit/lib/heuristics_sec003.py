# Human: Detection helpers for SEC-003 public share access to soft-deleted files.
# Agent: READS HttpResult JSON; no HTTP; used by runner and unit tests.

from __future__ import annotations

from typing import Any

from .heuristics_sec002 import extract_login_token
from .models import HttpResult

__all__ = [
    "extract_login_token",
    "extract_upload_file_id",
    "public_all_files_contains_id",
    "public_download_grants_file",
    "public_access_denied",
]


def extract_upload_file_id(res: HttpResult) -> str | None:
    if res.body_json is None or not isinstance(res.body_json, dict):
        return None
    for key in ("file", "id"):
        node = res.body_json.get(key)
        if isinstance(node, dict):
            fid = node.get("id")
            if isinstance(fid, str) and fid.strip():
                return fid.strip()
        if isinstance(node, str) and node.strip():
            return node.strip()
    return None


def _iter_file_ids(body_json: Any) -> list[str]:
    if body_json is None or not isinstance(body_json, dict):
        return []
    files = body_json.get("files")
    if not isinstance(files, list):
        return []
    ids: list[str] = []
    for row in files:
        if isinstance(row, dict):
            fid = row.get("id")
            if isinstance(fid, str) and fid.strip():
                ids.append(fid.strip())
    return ids


def public_all_files_contains_id(res: HttpResult, file_id: str) -> bool:
    # Human: True when GET all-files JSON still includes a trashed file id (vulnerability).
    # Agent: CHECKS files[].id membership; primary SEC-003 list exposure signal.
    return file_id in _iter_file_ids(res.body_json)


def public_download_grants_file(res: HttpResult) -> bool:
    # Human: True when download endpoint returns file bytes instead of API error JSON.
    # Agent: CHECKS HTTP 200 and non-JSON or attachment disposition.
    if res.status != 200:
        return False
    ct = res.headers.get("content-type", "")
    if "application/json" in ct and res.body_json is not None:
        return False
    disp = res.headers.get("content-disposition", "")
    if "attachment" in disp.lower():
        return True
    if res.body_text and not res.body_text.strip().startswith("{"):
        return True
    return bool(res.body_text) and res.body_json is None


def public_access_denied(res: HttpResult) -> bool:
    return res.status in (401, 403, 404, 410)
