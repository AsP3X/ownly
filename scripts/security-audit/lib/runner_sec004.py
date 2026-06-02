# Human: SEC-004 — authenticated download/preview still works after recycle-bin delete.
# Agent: HTTP probes with owner JWT; RETURNS AuditReport.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .bootstrap_sec004 import prepare_probe_file
from .constants_sec004 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC004,
    ROUTE_AUTH_LOGIN,
    ROUTE_FILES,
    ROUTE_RECYCLE_RESTORE,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec004 import build_endpoint_evidence
from .heuristics import api_error_detail, json_get
from .heuristics_sec003 import extract_login_token
from .heuristics_sec004 import (
    authenticated_access_denied,
    authenticated_download_grants_file,
    json_url_issued,
)
from .http_client import api_url, http_delete, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec004Config


def _http(cfg: Sec004Config):
    return cfg.http


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _file_route(suffix: str, file_id: str) -> str:
    return f"{ROUTE_FILES}/{file_id}{suffix}"


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
        remediation=REMEDIATION_SEC004,
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


def test_credentials_configured(cfg: Sec004Config, _cache: dict[str, Any]) -> CaseResult:
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


def test_target_reachable(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_complete(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
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


def test_owner_login(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
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


def test_probe_file_ready(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("owner_token")
    if not token:
        return CaseResult(
            name="probe_file_ready",
            passed=False,
            detail="skipped (no owner token)",
            severity="error",
        )
    file_id, err = prepare_probe_file(cfg, token)
    if err:
        return CaseResult(name="probe_file_ready", passed=False, detail=err, severity="error")
    cache["file_id"] = file_id
    return CaseResult(
        name="probe_file_ready",
        passed=True,
        detail=f"probe file_id={file_id[:8]}…",
        severity="pass",
    )


def _probe_get(
    cfg: Sec004Config,
    cache: dict[str, Any],
    *,
    cache_key: str,
    suffix: str,
) -> HttpResult:
    token = cache["owner_token"]
    file_id = cache["file_id"]
    res = http_get_with_retries(
        _http(cfg),
        api_url(_http(cfg), _file_route(suffix, file_id)),
        extra_headers=_auth(token),
    )
    cache[cache_key] = res
    _record_timing(cache, cache_key, res)
    return res


def test_download_works_before_trash(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    if not cache.get("owner_token") or not cache.get("file_id"):
        return CaseResult(name="download_works_before_trash", passed=False, detail="skipped", severity="error")
    res = _probe_get(cfg, cache, cache_key="download_before", suffix="/download")
    if authenticated_download_grants_file(res):
        return CaseResult(
            name="download_works_before_trash",
            passed=True,
            detail="download returns file bytes before trash",
            severity="pass",
        )
    return CaseResult(
        name="download_works_before_trash",
        passed=False,
        detail=f"download not available pre-trash (HTTP {res.status})",
        severity="error",
    )


def test_download_url_works_before_trash(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    if not cache.get("owner_token") or not cache.get("file_id"):
        return CaseResult(
            name="download_url_works_before_trash",
            passed=False,
            detail="skipped",
            severity="error",
        )
    res = _probe_get(cfg, cache, cache_key="download_url_before", suffix="/download-url")
    if json_url_issued(res):
        return CaseResult(
            name="download_url_works_before_trash",
            passed=True,
            detail="download-url returns presigned URL before trash",
            severity="pass",
        )
    return CaseResult(
        name="download_url_works_before_trash",
        passed=False,
        detail=f"download-url not issued pre-trash (HTTP {res.status})",
        severity="error",
    )


def test_preview_url_works_before_trash(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    if not cache.get("owner_token") or not cache.get("file_id"):
        return CaseResult(
            name="preview_url_works_before_trash",
            passed=False,
            detail="skipped",
            severity="error",
        )
    res = _probe_get(cfg, cache, cache_key="preview_url_before", suffix="/preview-url")
    if json_url_issued(res):
        return CaseResult(
            name="preview_url_works_before_trash",
            passed=True,
            detail="preview-url returns stream URL before trash",
            severity="pass",
        )
    return CaseResult(
        name="preview_url_works_before_trash",
        passed=False,
        detail=f"preview-url not issued pre-trash (HTTP {res.status})",
        severity="error",
    )


def test_soft_delete_applied(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
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


def test_download_blocked_after_trash(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    res = _probe_get(cfg, cache, cache_key="download_after", suffix="/download")
    file_id = cache.get("file_id", "")
    route = _file_route("/download", file_id)
    if authenticated_download_grants_file(res):
        cache["evidence_download"] = build_endpoint_evidence(
            res,
            route=route,
            file_id=file_id,
            title="Trashed file still downloadable via authenticated GET /download",
        )
        return fail_result(
            "download_blocked_after_trash",
            f"download still serves bytes after trash (HTTP {res.status})",
            evidence_key="download",
        )
    if authenticated_access_denied(res):
        return CaseResult(
            name="download_blocked_after_trash",
            passed=True,
            detail=f"download denied (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="download_blocked_after_trash",
        passed=False,
        detail=f"unexpected HTTP {res.status} on download after trash",
        severity="error",
    )


def test_download_url_blocked_after_trash(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    res = _probe_get(cfg, cache, cache_key="download_url_after", suffix="/download-url")
    file_id = cache.get("file_id", "")
    route = _file_route("/download-url", file_id)
    if json_url_issued(res):
        cache["evidence_download_url"] = build_endpoint_evidence(
            res,
            route=route,
            file_id=file_id,
            title="Trashed file still gets presigned download-url",
        )
        return fail_result(
            "download_url_blocked_after_trash",
            f"download-url still issued after trash (HTTP {res.status})",
            evidence_key="download_url",
        )
    if authenticated_access_denied(res):
        return CaseResult(
            name="download_url_blocked_after_trash",
            passed=True,
            detail=f"download-url denied (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="download_url_blocked_after_trash",
        passed=True,
        detail=f"no URL issued (HTTP {res.status})",
        severity="pass",
    )


def test_preview_url_blocked_after_trash(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    res = _probe_get(cfg, cache, cache_key="preview_url_after", suffix="/preview-url")
    file_id = cache.get("file_id", "")
    route = _file_route("/preview-url", file_id)
    if json_url_issued(res):
        cache["evidence_preview_url"] = build_endpoint_evidence(
            res,
            route=route,
            file_id=file_id,
            title="Trashed file still gets preview-url",
        )
        return fail_result(
            "preview_url_blocked_after_trash",
            f"preview-url still issued after trash (HTTP {res.status})",
            evidence_key="preview_url",
        )
    if authenticated_access_denied(res):
        return CaseResult(
            name="preview_url_blocked_after_trash",
            passed=True,
            detail=f"preview-url denied (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="preview_url_blocked_after_trash",
        passed=True,
        detail=f"no preview URL issued (HTTP {res.status})",
        severity="pass",
    )


def test_probe_file_restored(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
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


def test_exploit_primitive(cfg: Sec004Config, cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_authenticated",
        passed=True,
        detail="probes use owner Bearer JWT on /files/{id}/* routes",
        severity="pass",
    )


def run_sec004_audit(cfg: Sec004Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("credentials", lambda: test_credentials_configured(cfg, cache)),
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup", lambda: test_setup_complete(cfg, cache)),
        ("owner", lambda: test_owner_login(cfg, cache)),
        ("file", lambda: test_probe_file_ready(cfg, cache)),
        ("dl_before", lambda: test_download_works_before_trash(cfg, cache)),
        ("url_before", lambda: test_download_url_works_before_trash(cfg, cache)),
        ("pv_before", lambda: test_preview_url_works_before_trash(cfg, cache)),
        ("delete", lambda: test_soft_delete_applied(cfg, cache)),
        ("dl_after", lambda: test_download_blocked_after_trash(cfg, cache)),
        ("url_after", lambda: test_download_url_blocked_after_trash(cfg, cache)),
        ("pv_after", lambda: test_preview_url_blocked_after_trash(cfg, cache)),
        ("restore", lambda: test_probe_file_restored(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
    ]

    for name, fn in steps:
        result = run_case(name, fn)
        results.append(result)
        if name in ("target", "credentials") and not result.passed:
            break
        if name in ("owner", "file", "dl_before", "url_before", "pv_before") and not result.passed:
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
    for key in ("evidence_download", "evidence_download_url", "evidence_preview_url"):
        if key in cache:
            evidence[key.removeprefix("evidence_")] = cache[key]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC004)
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


def validate_target_url(cfg: Sec004Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
