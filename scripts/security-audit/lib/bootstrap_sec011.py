# Human: Prepare probe folder + file for SEC-011 zip archive audit.
# Agent: CALLS authenticated upload API; RETURNS folder_id and file_id.

from __future__ import annotations

import secrets
from typing import Any

from .constants_sec011 import ROUTE_FILES_UPLOAD, ROUTE_FOLDERS
from .heuristics_sec003 import extract_upload_file_id
from .http_client import api_url, http_post_json, http_post_multipart_file
from .models import Sec011Config


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_probe_folder(cfg: Sec011Config, token: str) -> tuple[str, Any]:
    http = cfg.http
    name = f"sec011-audit-{secrets.token_hex(3)}"
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


def upload_probe_file(cfg: Sec011Config, token: str, *, folder_id: str) -> tuple[str, Any]:
    http = cfg.http
    res = http_post_multipart_file(
        http,
        api_url(http, ROUTE_FILES_UPLOAD),
        filename="sec011-probe.txt",
        content=b"sec011-audit-probe\n",
        content_type="text/plain",
        folder_id=folder_id,
        extra_headers=_auth(token),
    )
    return extract_upload_file_id(res) or "", res


def prepare_probe_fixtures(cfg: Sec011Config, token: str) -> tuple[str, str, str | None]:
    # Human: Resolve folder_id + file_id — configured or bootstrapped.
    # Agent: RETURNS (folder_id, file_id, error_detail).
    if cfg.folder_id and cfg.file_id:
        return cfg.folder_id, cfg.file_id, None
    if not cfg.bootstrap_fixtures:
        return "", "", "missing folder_id/file_id — enable bootstrap or set SEC011_FOLDER_ID and SEC011_FILE_ID"
    folder_id, folder_res = create_probe_folder(cfg, token)
    if not folder_id:
        return "", "", f"create folder failed (HTTP {folder_res.status})"
    file_id, upload_res = upload_probe_file(cfg, token, folder_id=folder_id)
    if not file_id:
        return "", "", f"upload failed (HTTP {upload_res.status})"
    return folder_id, file_id, None
