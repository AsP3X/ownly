# Human: Prepare password-protected folder share for SEC-009 brute-force probe.
# Agent: CALLS owner APIs; RETURNS folder_id, file_id, share_id, share_token.

from __future__ import annotations

from .bootstrap_sec003 import (
    create_audit_folder,
    create_folder_share,
    find_folder_with_file,
    upload_probe_file,
)
from .constants_sec009 import DEFAULT_SHARE_PASSWORD, ROUTE_SHARE_BY_ID
from .http_client import api_url, http_patch_json
from .models import HttpResult, Sec009Config


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _extract_share_ids(res: HttpResult) -> tuple[str, str]:
    share_id = ""
    token = ""
    if res.status in (200, 201) and isinstance(res.body_json, dict):
        share = res.body_json.get("share")
        if isinstance(share, dict):
            raw_id = share.get("id")
            raw_token = share.get("token")
            if isinstance(raw_id, str):
                share_id = raw_id.strip()
            if isinstance(raw_token, str):
                token = raw_token.strip()
    return share_id, token


def enable_share_password(cfg: Sec009Config, owner_token: str, share_id: str) -> HttpResult:
    http = cfg.http
    password = cfg.share_password or DEFAULT_SHARE_PASSWORD
    return http_patch_json(
        http,
        api_url(http, ROUTE_SHARE_BY_ID.format(share_id=share_id)),
        {"requires_password": True, "password": password},
        extra_headers=_auth(owner_token),
    )


def prepare_fixtures(
    cfg: Sec009Config,
    owner_token: str,
) -> tuple[str, str, str, str, str | None]:
    # Human: Resolve ids and enable password — bootstrap or configured fixtures.
    # Agent: RETURNS (folder_id, file_id, share_id, share_token, error_detail).
    folder_id = cfg.folder_id
    file_id = cfg.file_id
    share_id = cfg.share_id
    share_token = cfg.share_token

    if cfg.share_id and cfg.share_token and not cfg.bootstrap_fixtures:
        if not cfg.share_password:
            return "", "", "", "", "share password required for pre-provisioned share"
        patch_res = enable_share_password(cfg, owner_token, share_id)
        if patch_res.status not in (200, 201):
            return "", "", "", "", f"enable password failed (HTTP {patch_res.status})"
        return folder_id, file_id, share_id, share_token, None

    if cfg.bootstrap_fixtures and not (folder_id and file_id):
        found = find_folder_with_file(cfg, owner_token)
        if found:
            folder_id, file_id = found

    if cfg.bootstrap_fixtures and not folder_id:
        folder_id, create_res = create_audit_folder(cfg, owner_token)
        if not folder_id:
            return "", "", "", "", f"create folder failed (HTTP {create_res.status})"

    if cfg.bootstrap_fixtures and folder_id and not file_id:
        file_id, upload_res = upload_probe_file(cfg, owner_token, folder_id)
        if not file_id:
            return folder_id, "", "", "", f"upload failed (HTTP {upload_res.status})"

    if not folder_id or not file_id:
        return "", "", "", "", "missing folder_id/file_id — bootstrap or set SEC009_* ids"

    if not share_token or not share_id:
        share_token, share_res = create_folder_share(cfg, owner_token, folder_id)
        share_id, parsed_token = _extract_share_ids(share_res)
        if parsed_token:
            share_token = parsed_token
        if not share_token or not share_id:
            return folder_id, file_id, "", "", f"create share failed (HTTP {share_res.status})"

    patch_res = enable_share_password(cfg, owner_token, share_id)
    if patch_res.status not in (200, 201):
        return folder_id, file_id, share_id, share_token, f"enable password failed (HTTP {patch_res.status})"

    return folder_id, file_id, share_id, share_token, None
