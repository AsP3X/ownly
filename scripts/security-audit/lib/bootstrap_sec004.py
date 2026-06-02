# Human: Prepare a probe file for SEC-004 (find existing or upload).
# Agent: CALLS authenticated upload API; RETURNS file_id.

from __future__ import annotations

import secrets
from typing import Any

from .constants_sec004 import ROUTE_FILES, ROUTE_FILES_UPLOAD, ROUTE_FOLDERS
from .heuristics_sec003 import extract_upload_file_id
from .http_client import api_url, http_get, http_post_json, http_post_multipart_file
from .models import Sec004Config


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def find_any_active_file(cfg: Sec004Config, token: str) -> str | None:
    # Human: Prefer root listing then any folder — first active file id wins.
    # Agent: READS GET /files; RETURNS file id or None.
    http = cfg.http
    for query in ("?limit=5", ""):
        res = http_get(http, api_url(http, f"{ROUTE_FILES}{query}"), extra_headers=_auth(token))
        if res.status != 200 or not isinstance(res.body_json, dict):
            continue
        files = res.body_json.get("files")
        if isinstance(files, list) and files:
            first = files[0]
            if isinstance(first, dict):
                fid = first.get("id")
                if isinstance(fid, str) and fid.strip():
                    return fid.strip()
    folders_res = http_get(http, api_url(http, ROUTE_FOLDERS), extra_headers=_auth(token))
    if folders_res.status == 200 and isinstance(folders_res.body_json, dict):
        folders = folders_res.body_json.get("folders")
        if isinstance(folders, list):
            for row in folders:
                if not isinstance(row, dict):
                    continue
                folder_id = row.get("id")
                if not isinstance(folder_id, str):
                    continue
                res = http_get(
                    http,
                    api_url(http, f"{ROUTE_FILES}?folder_id={folder_id}&limit=1"),
                    extra_headers=_auth(token),
                )
                if res.status == 200 and isinstance(res.body_json, dict):
                    files = res.body_json.get("files")
                    if isinstance(files, list) and files:
                        fid = files[0].get("id") if isinstance(files[0], dict) else None
                        if isinstance(fid, str) and fid.strip():
                            return fid.strip()
    return None


def upload_probe_file(cfg: Sec004Config, token: str, *, folder_id: str | None = None) -> tuple[str, Any]:
    http = cfg.http
    res = http_post_multipart_file(
        http,
        api_url(http, ROUTE_FILES_UPLOAD),
        filename="sec004-probe.txt",
        content=b"sec004-audit-probe\n",
        content_type="text/plain",
        folder_id=folder_id,
        extra_headers=_auth(token),
    )
    return extract_upload_file_id(res) or "", res


def create_probe_folder(cfg: Sec004Config, token: str) -> tuple[str, Any]:
    http = cfg.http
    name = f"sec004-audit-{secrets.token_hex(3)}"
    res = http_post_json(
        http,
        api_url(http, ROUTE_FOLDERS),
        {"name": name, "parent_id": None},
        extra_headers=_auth(token),
    )
    folder_id = ""
    if res.status in (200, 201) and isinstance(res.body_json, dict):
        folder = res.body_json.get("folder")
        if isinstance(folder, dict):
            raw = folder.get("id")
            if isinstance(raw, str):
                folder_id = raw.strip()
    return folder_id, res


def prepare_probe_file(cfg: Sec004Config, token: str) -> tuple[str, str | None]:
    # Human: Resolve probe file_id — configured, discovered, or uploaded.
    # Agent: RETURNS (file_id, error_detail).
    if cfg.file_id:
        return cfg.file_id, None
    if cfg.bootstrap_fixtures:
        found = find_any_active_file(cfg, token)
        if found:
            return found, None
        folder_id, folder_res = create_probe_folder(cfg, token)
        if not folder_id:
            return "", f"create folder failed (HTTP {folder_res.status})"
        file_id, upload_res = upload_probe_file(cfg, token, folder_id=folder_id)
        if not file_id:
            return "", f"upload failed (HTTP {upload_res.status})"
        return file_id, None
    return "", "missing file_id — enable bootstrap or set SEC004_FILE_ID"
