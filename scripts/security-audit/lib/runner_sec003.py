# Human: SEC-003 — folder public share still exposes file after recycle-bin delete.
# Agent: HTTP probes via http_client; RETURNS AuditReport; mutates then restores probe file.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .bootstrap_sec003 import (
    _share_password_headers,
    prepare_fixtures,
    public_route,
)
from .constants_sec003 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC003,
    ROUTE_AUTH_LOGIN,
    ROUTE_FILES,
    ROUTE_PUBLIC_ALL_FILES,
    ROUTE_PUBLIC_DOWNLOAD,
    ROUTE_RECYCLE_RESTORE,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec003 import build_public_leak_evidence
from .heuristics import api_error_detail, json_get
from .heuristics_sec003 import (
    extract_login_token,
    public_access_blocked_detail,
    public_access_denied,
    public_all_files_contains_id,
    public_download_grants_file,
)
from .http_client import api_url, http_delete, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec003Config


def _http(cfg: Sec003Config):
    return cfg.http


def _owner_auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _public_headers(cfg: Sec003Config) -> dict[str, str]:
    return _share_password_headers(cfg)


def fail_result(name: str, detail: str, *, evidence_key: str | None = None) -> CaseResult:
    return CaseResult(
        name=name,
        passed=False,
        detail=detail,
        severity="fail",
        evidence_key=evidence_key,
        remediation=REMEDIATION_SEC003,
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


def test_credentials_configured(cfg: Sec003Config, _cache: dict[str, Any]) -> CaseResult:
    if not cfg.owner_email or not cfg.owner_password:
        missing = []
        if not cfg.owner_email:
            missing.append("owner email")
        if not cfg.owner_password:
            missing.append("owner password")
        return CaseResult(
            name="credentials_configured",
            passed=False,
            detail=f"missing: {', '.join(missing)}",
            severity="error",
        )
    return CaseResult(
        name="credentials_configured",
        passed=True,
        detail="owner credentials configured",
        severity="pass",
    )


def test_target_reachable(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_complete(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    res: HttpResult = cache["setup_status"]
    complete = json_get(res.body_json, "setup_complete") if res.body_json else None
    cache["setup_complete"] = complete
    if complete is True:
        return CaseResult(
            name="setup_complete_required",
            passed=True,
            detail="setup_complete=true",
            severity="pass",
        )
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
        detail=f"setup_complete={complete!r} (requirement relaxed)",
        severity="pass",
    )


def test_owner_login(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    res = http_post_json(
        http,
        api_url(http, ROUTE_AUTH_LOGIN),
        {"email": cfg.owner_email, "password": cfg.owner_password},
    )
    cache["owner_login"] = res
    _record_timing(cache, "owner_login", res)
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


def test_fixtures_ready(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("owner_token")
    if not token:
        return CaseResult(
            name="fixtures_ready",
            passed=False,
            detail="skipped (no owner token)",
            severity="error",
        )
    folder_id, file_id, share_token, err = prepare_fixtures(cfg, cache, token)
    if err:
        return CaseResult(
            name="fixtures_ready",
            passed=False,
            detail=err,
            severity="error",
        )
    cache["folder_id"] = folder_id
    cache["file_id"] = file_id
    cache["share_token"] = share_token
    mode = "bootstrap" if cfg.bootstrap_fixtures else "configured"
    return CaseResult(
        name="fixtures_ready",
        passed=True,
        detail=f"folder share ready ({mode}); file_id={file_id[:8]}… token={share_token[:8]}…",
        severity="pass",
    )


def test_public_lists_file_before_delete(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    token = cache.get("share_token")
    file_id = cache.get("file_id")
    if not token or not file_id:
        return CaseResult(
            name="public_lists_file_before_delete",
            passed=False,
            detail="skipped (fixtures missing)",
            severity="error",
        )
    route = public_route(ROUTE_PUBLIC_ALL_FILES, token=token)
    res = http_get_with_retries(
        http,
        api_url(http, route),
        extra_headers=_public_headers(cfg),
    )
    cache["all_files_before"] = res
    _record_timing(cache, "all_files_before", res)
    if res.status != 200:
        detail = public_access_blocked_detail(
            res,
            share_password_configured=bool(cfg.share_password),
        )
        return CaseResult(
            name="public_lists_file_before_delete",
            passed=False,
            detail=f"GET all-files before delete: {detail}",
            severity="error",
        )
    if not public_all_files_contains_id(res, file_id):
        return CaseResult(
            name="public_lists_file_before_delete",
            passed=False,
            detail="probe file not listed before delete (cannot validate exploit baseline)",
            severity="error",
        )
    return CaseResult(
        name="public_lists_file_before_delete",
        passed=True,
        detail="probe file visible on public all-files before trash",
        severity="pass",
    )


def test_soft_delete_applied(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    owner = cache.get("owner_token")
    file_id = cache.get("file_id")
    if not owner or not file_id:
        return CaseResult(
            name="soft_delete_applied",
            passed=False,
            detail="skipped (missing owner token or file_id)",
            severity="error",
        )
    res = http_delete(
        http,
        api_url(http, f"{ROUTE_FILES}/{file_id}"),
        extra_headers=_owner_auth(owner),
    )
    cache["soft_delete"] = res
    _record_timing(cache, "soft_delete", res)
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
        detail="probe file soft-deleted (recycle bin)",
        severity="pass",
    )


def test_public_all_files_excludes_deleted(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    token = cache.get("share_token")
    file_id = cache.get("file_id")
    if not token or not file_id:
        return CaseResult(
            name="public_all_files_excludes_deleted",
            passed=False,
            detail="skipped (fixtures missing)",
            severity="error",
        )
    route = public_route(ROUTE_PUBLIC_ALL_FILES, token=token)
    res = http_get_with_retries(
        http,
        api_url(http, route),
        extra_headers=_public_headers(cfg),
    )
    cache["all_files_after"] = res
    _record_timing(cache, "all_files_after", res)
    if public_all_files_contains_id(res, file_id):
        cache["evidence_all_files"] = build_public_leak_evidence(
            res,
            route=route,
            file_id=file_id,
            title="Trashed file still listed on public all-files",
        )
        return fail_result(
            "public_all_files_excludes_deleted",
            f"trashed file_id still in all-files (HTTP {res.status})",
            evidence_key="all_files",
        )
    if res.status == 200:
        return CaseResult(
            name="public_all_files_excludes_deleted",
            passed=True,
            detail="all-files omits trashed probe file (fixed)",
            severity="pass",
        )
    if public_access_denied(res):
        return CaseResult(
            name="public_all_files_excludes_deleted",
            passed=True,
            detail=f"share inaccessible after delete (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="public_all_files_excludes_deleted",
        passed=False,
        detail=f"unexpected HTTP {res.status} on all-files after delete",
        severity="error",
    )


def test_public_download_blocked_after_delete(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    token = cache.get("share_token")
    file_id = cache.get("file_id")
    if not token or not file_id:
        return CaseResult(
            name="public_download_blocked_after_delete",
            passed=False,
            detail="skipped (fixtures missing)",
            severity="error",
        )
    route = public_route(ROUTE_PUBLIC_DOWNLOAD, token=token, file_id=file_id)
    res = http_get_with_retries(
        http,
        api_url(http, route),
        extra_headers=_public_headers(cfg),
    )
    cache["download_after"] = res
    _record_timing(cache, "download_after", res)
    if public_download_grants_file(res):
        cache["evidence_download"] = build_public_leak_evidence(
            res,
            route=route,
            file_id=file_id,
            title="Trashed file still downloadable via public share",
        )
        return fail_result(
            "public_download_blocked_after_delete",
            f"public download succeeded after trash (HTTP {res.status})",
            evidence_key="download",
        )
    if public_access_denied(res):
        return CaseResult(
            name="public_download_blocked_after_delete",
            passed=True,
            detail=f"download denied after trash (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="public_download_blocked_after_delete",
        passed=True,
        detail=f"download not granted (HTTP {res.status})",
        severity="pass",
    )


def test_probe_file_restored(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
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
        return CaseResult(
            name="probe_file_restored",
            passed=False,
            detail="cleanup skipped",
            severity="error",
        )
    res = http_post_json(
        _http(cfg),
        api_url(_http(cfg), ROUTE_RECYCLE_RESTORE),
        {"file_ids": [file_id], "folder_ids": []},
        extra_headers=_owner_auth(owner),
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
    detail += " (cleanup only; SEC-003 verdict unchanged — restore manually or use --no-restore)"
    return CaseResult(
        name="probe_file_restored",
        passed=False,
        detail=detail,
        severity="error",
    )


def test_exploit_primitive(cfg: Sec003Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("share_token", "")
    shown = f"{token[:8]}…" if len(token) > 8 else "(none)"
    return CaseResult(
        name="exploit_primitive_unauthenticated",
        passed=True,
        detail=f"public routes use share token only ({shown}), not owner JWT",
        severity="pass",
    )


def run_sec003_audit(cfg: Sec003Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("credentials", lambda: test_credentials_configured(cfg, cache)),
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup", lambda: test_setup_complete(cfg, cache)),
        ("owner", lambda: test_owner_login(cfg, cache)),
        ("fixtures", lambda: test_fixtures_ready(cfg, cache)),
        ("before", lambda: test_public_lists_file_before_delete(cfg, cache)),
        ("delete", lambda: test_soft_delete_applied(cfg, cache)),
        ("all_files", lambda: test_public_all_files_excludes_deleted(cfg, cache)),
        ("download", lambda: test_public_download_blocked_after_delete(cfg, cache)),
        ("restore", lambda: test_probe_file_restored(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
    ]

    for name, fn in steps:
        result = run_case(name, fn)
        results.append(result)
        if name == "target" and not result.passed and result.severity == "error":
            break
        if name == "credentials" and not result.passed:
            break
        if name in ("owner", "fixtures", "before") and not result.passed:
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
    if "evidence_all_files" in cache:
        evidence["all_files"] = cache["evidence_all_files"]
    if "evidence_download" in cache:
        evidence["download"] = cache["evidence_download"]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC003)
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


def validate_target_url(cfg: Sec003Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
