# Human: SEC-011 — folder and bulk zip archives include soft-deleted files.
# Agent: HTTP probes with owner JWT; RETURNS AuditReport.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .bootstrap_sec011 import prepare_probe_fixtures
from .constants_sec011 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC011,
    ROUTE_AUTH_LOGIN,
    ROUTE_FILES,
    ROUTE_FILES_BULK_DOWNLOAD,
    ROUTE_FOLDERS,
    ROUTE_RECYCLE_RESTORE,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec011 import build_zip_evidence
from .heuristics import api_error_detail, json_get
from .heuristics_sec003 import extract_login_token
from .heuristics_sec011 import zip_access_denied, zip_job_started
from .http_client import api_url, http_delete, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec011Config


def _http(cfg: Sec011Config):
    return cfg.http


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def fail_result(
    name: str,
    detail: str,
    *,
    evidence_key: str | None = None,
) -> CaseResult:
    return CaseResult(
        name=name,
        passed=False,
        detail=detail,
        severity="fail",
        evidence_key=evidence_key,
        remediation=REMEDIATION_SEC011,
    )


def run_case(name: str, fn: Callable[[], CaseResult]) -> CaseResult:
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return CaseResult(
            name=name,
            passed=False,
            detail=f"unexpected error: {exc}",
            severity="error",
        )


def _record_timing(cache: dict[str, Any], key: str, res: HttpResult) -> None:
    if res.elapsed_ms is not None:
        cache.setdefault("timings_ms", {})[key] = round(res.elapsed_ms, 1)


def test_credentials_configured(cfg: Sec011Config, _cache: dict[str, Any]) -> CaseResult:
    if not cfg.owner_email or not cfg.owner_password:
        return CaseResult(
            name="credentials_configured",
            passed=False,
            detail="missing owner email or password",
            severity="error",
        )
    return CaseResult(
        name="credentials_configured",
        passed=True,
        detail="owner credentials configured",
        severity="pass",
    )


def test_target_reachable(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    url = api_url(http, ROUTE_SETUP_STATUS)
    res = http_get_with_retries(http, url)
    cache["setup_status"] = res
    _record_timing(cache, "setup_status", res)
    if res.error:
        return CaseResult(
            name="target_reachable",
            passed=False,
            detail=f"cannot reach {url}: {res.error}",
            severity="error",
        )
    return CaseResult(
        name="target_reachable",
        passed=True,
        detail=f"GET {ROUTE_SETUP_STATUS} -> HTTP {res.status}",
        severity="pass",
    )


def test_setup_complete(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    res: HttpResult = cache["setup_status"]
    complete = json_get(res.body_json, "setup_complete") if res.body_json else None
    cache["setup_complete"] = complete
    if complete is True:
        return CaseResult(name="setup_complete_required", passed=True, detail="setup_complete=true", severity="pass")
    if _http(cfg).require_setup_complete:
        return CaseResult(
            name="setup_complete_required",
            passed=False,
            detail=f"setup_complete={complete!r}",
            severity="error",
        )
    return CaseResult(
        name="setup_complete_required",
        passed=True,
        detail=f"setup_complete={complete!r} (relaxed)",
        severity="pass",
    )


def test_owner_login(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    res = http_post_json(
        _http(cfg),
        api_url(_http(cfg), ROUTE_AUTH_LOGIN),
        {"email": cfg.owner_email, "password": cfg.owner_password},
    )
    cache["owner_login"] = res
    if res.error or res.status != 200:
        return CaseResult(
            name="owner_login",
            passed=False,
            detail=f"login failed (HTTP {res.status})",
            severity="error",
        )
    token = extract_login_token(res)
    if not token:
        return CaseResult(
            name="owner_login",
            passed=False,
            detail="login response missing token",
            severity="error",
        )
    cache["owner_token"] = token
    return CaseResult(
        name="owner_login",
        passed=True,
        detail=f"authenticated as {cfg.owner_email}",
        severity="pass",
    )


def test_probe_fixtures_ready(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("owner_token")
    if not token:
        return CaseResult(
            name="probe_fixtures_ready",
            passed=False,
            detail="skipped (no owner token)",
            severity="error",
        )
    folder_id, file_id, err = prepare_probe_fixtures(cfg, token)
    if err:
        return CaseResult(name="probe_fixtures_ready", passed=False, detail=err, severity="error")
    cache["folder_id"] = folder_id
    cache["file_id"] = file_id
    return CaseResult(
        name="probe_fixtures_ready",
        passed=True,
        detail=f"folder_id={folder_id[:8]}… file_id={file_id[:8]}…",
        severity="pass",
    )


def _post_bulk_download(cfg: Sec011Config, cache: dict[str, Any], *, cache_key: str) -> HttpResult:
    token = cache["owner_token"]
    file_id = cache["file_id"]
    res = http_post_json(
        _http(cfg),
        api_url(_http(cfg), ROUTE_FILES_BULK_DOWNLOAD),
        {"file_ids": [file_id]},
        extra_headers=_auth(token),
    )
    cache[cache_key] = res
    _record_timing(cache, cache_key, res)
    return res


def _post_folder_download(cfg: Sec011Config, cache: dict[str, Any], *, cache_key: str) -> HttpResult:
    token = cache["owner_token"]
    folder_id = cache["folder_id"]
    res = http_post_json(
        _http(cfg),
        api_url(_http(cfg), f"{ROUTE_FOLDERS}/{folder_id}/download"),
        {},
        extra_headers=_auth(token),
    )
    cache[cache_key] = res
    _record_timing(cache, cache_key, res)
    return res


def test_bulk_zip_works_before_trash(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    if not cache.get("owner_token") or not cache.get("file_id"):
        return CaseResult(name="bulk_zip_works_before_trash", passed=False, detail="skipped", severity="error")
    res = _post_bulk_download(cfg, cache, cache_key="bulk_before")
    if zip_job_started(res):
        return CaseResult(
            name="bulk_zip_works_before_trash",
            passed=True,
            detail="bulk zip job queued before trash",
            severity="pass",
        )
    return CaseResult(
        name="bulk_zip_works_before_trash",
        passed=False,
        detail=f"bulk zip not available pre-trash (HTTP {res.status})",
        severity="error",
    )


def test_folder_zip_works_before_trash(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    if not cache.get("owner_token") or not cache.get("folder_id"):
        return CaseResult(
            name="folder_zip_works_before_trash",
            passed=False,
            detail="skipped",
            severity="error",
        )
    res = _post_folder_download(cfg, cache, cache_key="folder_before")
    if zip_job_started(res):
        return CaseResult(
            name="folder_zip_works_before_trash",
            passed=True,
            detail="folder zip job queued before trash",
            severity="pass",
        )
    return CaseResult(
        name="folder_zip_works_before_trash",
        passed=False,
        detail=f"folder zip not available pre-trash (HTTP {res.status})",
        severity="error",
    )


def test_soft_delete_applied(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    owner = cache.get("owner_token")
    file_id = cache.get("file_id")
    if not owner or not file_id:
        return CaseResult(name="soft_delete_applied", passed=False, detail="skipped", severity="error")
    res = http_delete(
        _http(cfg),
        api_url(_http(cfg), f"{ROUTE_FILES}/{file_id}"),
        extra_headers=_auth(owner),
    )
    if res.status not in (200, 204):
        return CaseResult(
            name="soft_delete_applied",
            passed=False,
            detail=f"DELETE file -> HTTP {res.status}",
            severity="error",
        )
    return CaseResult(
        name="soft_delete_applied",
        passed=True,
        detail="probe file soft-deleted",
        severity="pass",
    )


def test_bulk_zip_blocked_after_trash(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    res = _post_bulk_download(cfg, cache, cache_key="bulk_after")
    file_id = cache.get("file_id", "")
    route = ROUTE_FILES_BULK_DOWNLOAD
    if zip_job_started(res):
        cache["evidence_bulk_zip"] = build_zip_evidence(
            res,
            route=route,
            file_id=file_id,
            title="Trashed file still accepted by bulk zip download",
        )
        return fail_result(
            "bulk_zip_blocked_after_trash",
            f"bulk zip job still starts for trashed file (HTTP {res.status})",
            evidence_key="bulk_zip",
        )
    if zip_access_denied(res):
        return CaseResult(
            name="bulk_zip_blocked_after_trash",
            passed=True,
            detail=f"bulk zip denied (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="bulk_zip_blocked_after_trash",
        passed=True,
        detail=f"no bulk zip job started (HTTP {res.status})",
        severity="pass",
    )


def test_folder_zip_blocked_after_trash(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    res = _post_folder_download(cfg, cache, cache_key="folder_after")
    file_id = cache.get("file_id", "")
    folder_id = cache.get("folder_id", "")
    route = f"{ROUTE_FOLDERS}/{folder_id}/download"
    if zip_job_started(res):
        cache["evidence_folder_zip"] = build_zip_evidence(
            res,
            route=route,
            file_id=file_id,
            title="Folder zip still queues after sole file trashed",
        )
        return fail_result(
            "folder_zip_blocked_after_trash",
            f"folder zip job still starts with trashed member (HTTP {res.status})",
            evidence_key="folder_zip",
        )
    if zip_access_denied(res):
        return CaseResult(
            name="folder_zip_blocked_after_trash",
            passed=True,
            detail=f"folder zip denied (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="folder_zip_blocked_after_trash",
        passed=True,
        detail=f"no folder zip job started (HTTP {res.status})",
        severity="pass",
    )


def test_probe_file_restored(cfg: Sec011Config, cache: dict[str, Any]) -> CaseResult:
    if not cfg.restore_after_probe:
        return CaseResult(
            name="probe_file_restored",
            passed=True,
            detail="skipped (--no-restore)",
            severity="pass",
        )
    owner = cache.get("owner_token")
    file_id = cache.get("file_id")
    if not owner or not file_id:
        return CaseResult(name="probe_file_restored", passed=False, detail="cleanup skipped", severity="error")
    res = http_post_json(
        _http(cfg),
        api_url(_http(cfg), ROUTE_RECYCLE_RESTORE),
        {"file_ids": [file_id], "folder_ids": []},
        extra_headers=_auth(owner),
    )
    if res.status in (200, 201):
        return CaseResult(
            name="probe_file_restored",
            passed=True,
            detail="probe file restored from recycle bin",
            severity="pass",
        )
    extra = api_error_detail(res)
    detail = f"restore -> HTTP {res.status}"
    if extra:
        detail += f" — {extra}"
    detail += " (cleanup only; use --no-restore to skip)"
    return CaseResult(name="probe_file_restored", passed=False, detail=detail, severity="error")


def test_exploit_primitive(_cfg: Sec011Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_authenticated",
        passed=True,
        detail="probes use owner Bearer JWT on bulk and folder zip routes",
        severity="pass",
    )


def run_sec011_audit(cfg: Sec011Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("credentials", lambda: test_credentials_configured(cfg, cache)),
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup", lambda: test_setup_complete(cfg, cache)),
        ("owner", lambda: test_owner_login(cfg, cache)),
        ("fixtures", lambda: test_probe_fixtures_ready(cfg, cache)),
        ("bulk_before", lambda: test_bulk_zip_works_before_trash(cfg, cache)),
        ("folder_before", lambda: test_folder_zip_works_before_trash(cfg, cache)),
        ("delete", lambda: test_soft_delete_applied(cfg, cache)),
        ("bulk_after", lambda: test_bulk_zip_blocked_after_trash(cfg, cache)),
        ("folder_after", lambda: test_folder_zip_blocked_after_trash(cfg, cache)),
        ("restore", lambda: test_probe_file_restored(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
    ]

    for name, fn in steps:
        result = run_case(name, fn)
        results.append(result)
        if name in ("target", "credentials") and not result.passed:
            break
        if name in ("owner", "fixtures", "bulk_before", "folder_before") and not result.passed:
            break
        if cfg.http.fail_fast and not result.passed and result.severity == "fail":
            break

    fails = [r for r in results if not r.passed and r.severity == "fail"]
    errors = [r for r in results if not r.passed and r.severity == "error"]
    if fails:
        verdict, exit_code = "vulnerable", 1
    elif errors:
        verdict, exit_code = "inconclusive", 2
    else:
        verdict, exit_code = "ok", 0

    evidence = {}
    for key in ("evidence_bulk_zip", "evidence_folder_zip"):
        if key in cache:
            evidence[key.removeprefix("evidence_")] = cache[key]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC011)
        hints.append(AUDIT_LOG_HINT)

    http = _http(cfg)
    report = AuditReport(
        audit_id=AUDIT_ID,
        target=f"{http.base_url}{http.api_prefix}",
        verdict=verdict,
        exit_code=exit_code,
        setup_complete=cache.get("setup_complete"),
        results=results,
        evidence=evidence,
        timings_ms=cache.get("timings_ms", {}),
        remediation_hints=hints,
    )
    return report, cache


def validate_target_url(cfg: Sec011Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
