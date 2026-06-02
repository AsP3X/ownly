# Human: Prepare folder share + probe file for SEC-003 (find, create, or upload).
# Agent: CALLS authenticated API; RETURNS ids stored in runner cache.

from __future__ import annotations

import secrets
from typing import Any

from .constants_sec003 import (
    ROUTE_FILES,
    ROUTE_FILES_UPLOAD,
    ROUTE_FOLDERS,
    ROUTE_SHARES,
)
from .heuristics_sec003 import extract_upload_file_id
from .http_client import api_url, http_get, http_post_json, http_post_multipart_file
from .models import HttpResult, Sec003Config


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _share_password_headers(cfg: Sec003Config) -> dict[str, str]:
    if not cfg.share_password:
        return {}
    return {"x-share-password": cfg.share_password}


def find_folder_with_file(cfg: Sec003Config, owner_token: str) -> tuple[str, str] | None:
    # Human: Scan drive for any folder that already contains at least one file.
    # Agent: READS /folders and /files; RETURNS (folder_id, file_id) or None.
    http = cfg.http
    folders_res = http_get(
        http,
        api_url(http, ROUTE_FOLDERS),
        extra_headers=_auth_headers(owner_token),
    )
    if folders_res.status != 200 or not isinstance(folders_res.body_json, dict):
        return None
    folders = folders_res.body_json.get("folders")
    if not isinstance(folders, list):
        return None
    for row in folders:
        if not isinstance(row, dict):
            continue
        folder_id = row.get("id")
        if not isinstance(folder_id, str) or not folder_id.strip():
            continue
        files_res = http_get(
            http,
            api_url(http, f"{ROUTE_FILES}?folder_id={folder_id}&limit=5"),
            extra_headers=_auth_headers(owner_token),
        )
        if files_res.status != 200 or not isinstance(files_res.body_json, dict):
            continue
        files = files_res.body_json.get("files")
        if isinstance(files, list) and files:
            first = files[0]
            if isinstance(first, dict):
                file_id = first.get("id")
                if isinstance(file_id, str) and file_id.strip():
                    return folder_id.strip(), file_id.strip()
    return None


def create_audit_folder(cfg: Sec003Config, owner_token: str) -> tuple[str, HttpResult]:
    http = cfg.http
    name = f"sec003-audit-{secrets.token_hex(3)}"
    res = http_post_json(
        http,
        api_url(http, ROUTE_FOLDERS),
        {"name": name, "parent_id": None},
        extra_headers=_auth_headers(owner_token),
    )
    folder_id = ""
    if res.status in (200, 201) and isinstance(res.body_json, dict):
        folder = res.body_json.get("folder")
        if isinstance(folder, dict):
            raw = folder.get("id")
            if isinstance(raw, str):
                folder_id = raw.strip()
    return folder_id, res


def upload_probe_file(cfg: Sec003Config, owner_token: str, folder_id: str) -> tuple[str, HttpResult]:
    http = cfg.http
    content = b"sec003-audit-probe\n"
    res = http_post_multipart_file(
        http,
        api_url(http, ROUTE_FILES_UPLOAD),
        filename="sec003-probe.txt",
        content=content,
        content_type="text/plain",
        folder_id=folder_id,
        extra_headers=_auth_headers(owner_token),
    )
    file_id = extract_upload_file_id(res) or ""
    return file_id, res


def create_folder_share(
    cfg: Sec003Config,
    owner_token: str,
    folder_id: str,
) -> tuple[str, HttpResult]:
    http = cfg.http
    res = http_post_json(
        http,
        api_url(http, ROUTE_SHARES),
        {"resource_type": "folder", "resource_id": folder_id},
        extra_headers=_auth_headers(owner_token),
    )
    token = ""
    if res.status in (200, 201) and isinstance(res.body_json, dict):
        share = res.body_json.get("share")
        if isinstance(share, dict):
            raw = share.get("token")
            if isinstance(raw, str):
                token = raw.strip()
    return token, res


def prepare_fixtures(cfg: Sec003Config, cache: dict[str, Any], owner_token: str) -> tuple[str, str, str, str | None]:
    # Human: Resolve folder_id, file_id, share_token — bootstrap or use configured ids.
    # Agent: RETURNS (folder_id, file_id, share_token, error_detail).
    if cfg.folder_id and cfg.file_id and cfg.share_token:
        return cfg.folder_id, cfg.file_id, cfg.share_token, None

    folder_id = cfg.folder_id
    file_id = cfg.file_id
    share_token = cfg.share_token

    if cfg.bootstrap_fixtures and not (folder_id and file_id):
        found = find_folder_with_file(cfg, owner_token)
        if found:
            folder_id, file_id = found

    if cfg.bootstrap_fixtures and not folder_id:
        folder_id, create_res = create_audit_folder(cfg, owner_token)
        if not folder_id:
            return "", "", "", f"create folder failed (HTTP {create_res.status})"

    if cfg.bootstrap_fixtures and folder_id and not file_id:
        file_id, upload_res = upload_probe_file(cfg, owner_token, folder_id)
        if not file_id:
            return folder_id, "", "", f"upload probe file failed (HTTP {upload_res.status})"

    if not folder_id or not file_id:
        return "", "", "", "missing folder_id/file_id — enable --bootstrap-fixtures or set SEC003_* ids"

    if not share_token:
        share_token, share_res = create_folder_share(cfg, owner_token, folder_id)
        if not share_token:
            return folder_id, file_id, "", f"create folder share failed (HTTP {share_res.status})"

    return folder_id, file_id, share_token, None


def public_route(template: str, *, token: str, file_id: str = "") -> str:
    path = template.format(token=token, file_id=file_id)
    return path
