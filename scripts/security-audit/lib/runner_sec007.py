# Human: SEC-007 — password-protected share overview without x-share-password.
# Agent: HTTP probes; RETURNS AuditReport; bootstraps folder share + optional revoke.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .bootstrap_sec003 import public_route
from .bootstrap_sec007 import prepare_fixtures, public_overview_url
from .constants_sec007 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC007,
    ROUTE_AUTH_LOGIN,
    ROUTE_PUBLIC_CONTENTS,
    ROUTE_PUBLIC_OVERVIEW,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec007 import build_overview_evidence
from .heuristics import json_get
from .heuristics_sec003 import extract_login_token
from .heuristics_sec007 import (
    overview_metadata_leaked,
    overview_requires_password_flag,
    public_access_denied,
)
from .http_client import api_url, http_delete, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec007Config


def _http(cfg: Sec007Config):
    return cfg.http


def _owner_auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _share_password_headers(cfg: Sec007Config) -> dict[str, str]:
    if not cfg.share_password:
        return {}
    return {"x-share-password": cfg.share_password}


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
        remediation=REMEDIATION_SEC007,
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


def test_credentials_configured(cfg: Sec007Config, _cache: dict[str, Any]) -> CaseResult:
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


def test_target_reachable(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_complete(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
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
        detail=f"setup_complete={complete!r} (continuing)",
        severity="pass",
    )


def test_owner_login(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    res = http_post_json(
        http,
        api_url(http, ROUTE_AUTH_LOGIN),
        {"email": cfg.owner_email, "password": cfg.owner_password},
    )
    _record_timing(cache, "owner_login", res)
    token = extract_login_token(res)
    if not token:
        return CaseResult(
            name="owner_login",
            passed=False,
            detail=f"login failed (HTTP {res.status})",
            severity="error",
        )
    cache["owner_token"] = token
    return CaseResult(
        name="owner_login",
        passed=True,
        detail="owner authenticated",
        severity="pass",
    )


def test_fixtures_ready(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("owner_token")
    if not isinstance(token, str) or not token:
        return CaseResult(
            name="fixtures_ready",
            passed=False,
            detail="skipped (no owner token)",
            severity="error",
        )
    folder_id, file_id, share_id, share_token, err = prepare_fixtures(cfg, token)
    if err:
        return CaseResult(
            name="fixtures_ready",
            passed=False,
            detail=err,
            severity="error",
        )
    cache["folder_id"] = folder_id
    cache["file_id"] = file_id
    cache["share_id"] = share_id
    cache["share_token"] = share_token
    return CaseResult(
        name="fixtures_ready",
        passed=True,
        detail=f"share token ready (folder {folder_id[:8]}…)",
        severity="pass",
    )


def test_share_password_enabled(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="share_password_enabled",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    http = _http(cfg)
    res = http_get_with_retries(
        http,
        public_overview_url(cfg, share_token),
        extra_headers=_share_password_headers(cfg),
    )
    if overview_requires_password_flag(res):
        return CaseResult(
            name="share_password_enabled",
            passed=True,
            detail="overview reports requires_password=true (with password header)",
            severity="pass",
        )
    return CaseResult(
        name="share_password_enabled",
        passed=False,
        detail=f"password protection not confirmed (HTTP {res.status})",
        severity="error",
    )


def test_exploit_primitive(_cfg: Sec007Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_unauthenticated",
        passed=True,
        detail="overview/contents probes omit Authorization and x-share-password",
        severity="pass",
    )


def test_overview_without_password(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="overview_leaks_metadata_without_password",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    http = _http(cfg)
    res = http_get_with_retries(http, public_overview_url(cfg, share_token))
    cache["overview_plain"] = res
    _record_timing(cache, "overview_plain", res)
    if res.error:
        return CaseResult(
            name="overview_leaks_metadata_without_password",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )
    if overview_metadata_leaked(res):
        cache["evidence_overview"] = build_overview_evidence(
            res,
            route=public_route(ROUTE_PUBLIC_OVERVIEW, token=share_token),
            title="Overview metadata without password",
            had_password_header=False,
        )
        return fail_result(
            "overview_leaks_metadata_without_password",
            f"GET overview returned metadata without password (HTTP {res.status})",
            evidence_key="overview",
        )
    if public_access_denied(res):
        return CaseResult(
            name="overview_blocked_without_password",
            passed=True,
            detail=f"overview denied without password (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="overview_blocked_without_password",
        passed=True,
        detail=f"overview did not leak metadata (HTTP {res.status})",
        severity="pass",
    )


def test_contents_without_password(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="contents_blocked_without_password",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    http = _http(cfg)
    url = api_url(http, public_route(ROUTE_PUBLIC_CONTENTS, token=share_token))
    res = http_get_with_retries(http, url)
    cache["contents_plain"] = res
    _record_timing(cache, "contents_plain", res)
    if public_access_denied(res):
        return CaseResult(
            name="contents_blocked_without_password",
            passed=True,
            detail=f"contents denied without password (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="contents_blocked_without_password",
        passed=False,
        detail=f"contents reachable without password (HTTP {res.status})",
        severity="error",
    )


def test_overview_with_password(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="overview_works_with_password",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    http = _http(cfg)
    res = http_get_with_retries(
        http,
        public_overview_url(cfg, share_token),
        extra_headers=_share_password_headers(cfg),
    )
    _record_timing(cache, "overview_auth", res)
    if res.error:
        return CaseResult(
            name="overview_works_with_password",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )
    if res.status == 200 and overview_requires_password_flag(res):
        return CaseResult(
            name="overview_works_with_password",
            passed=True,
            detail="overview OK with correct x-share-password",
            severity="pass",
        )
    return CaseResult(
        name="overview_works_with_password",
        passed=False,
        detail=f"overview with password unexpected (HTTP {res.status})",
        severity="error",
    )


def test_revoke_share(cfg: Sec007Config, cache: dict[str, Any]) -> CaseResult:
    if not cfg.revoke_after_probe:
        return CaseResult(
            name="share_revoked_after_probe",
            passed=True,
            detail="skipped (--no-revoke)",
            severity="pass",
        )
    share_id = cache.get("share_id")
    owner_token = cache.get("owner_token")
    if not isinstance(share_id, str) or not share_id or not isinstance(owner_token, str):
        return CaseResult(
            name="share_revoked_after_probe",
            passed=True,
            detail="skipped (no share id)",
            severity="pass",
        )
    http = _http(cfg)
    res = http_delete(
        http,
        api_url(http, f"/shares/{share_id}"),
        extra_headers=_owner_auth(owner_token),
    )
    if res.status in (200, 204):
        return CaseResult(
            name="share_revoked_after_probe",
            passed=True,
            detail="probe share revoked",
            severity="pass",
        )
    return CaseResult(
        name="share_revoked_after_probe",
        passed=False,
        detail=f"revoke failed (HTTP {res.status})",
        severity="error",
    )


def run_sec007_audit(cfg: Sec007Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("credentials", lambda: test_credentials_configured(cfg, cache)),
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup", lambda: test_setup_complete(cfg, cache)),
        ("login", lambda: test_owner_login(cfg, cache)),
        ("fixtures", lambda: test_fixtures_ready(cfg, cache)),
        ("password", lambda: test_share_password_enabled(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
        ("overview", lambda: test_overview_without_password(cfg, cache)),
        ("contents", lambda: test_contents_without_password(cfg, cache)),
        ("overview_ok", lambda: test_overview_with_password(cfg, cache)),
        ("revoke", lambda: test_revoke_share(cfg, cache)),
    ]

    for name, fn in steps:
        result = run_case(name, fn)
        results.append(result)
        if result.severity == "error" and name == "target":
            break
        if _http(cfg).fail_fast and not result.passed and result.severity == "fail":
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
    if "evidence_overview" in cache:
        evidence["overview"] = cache["evidence_overview"]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC007)
        hints.append(AUDIT_LOG_HINT)

    report = AuditReport(
        audit_id=AUDIT_ID,
        target=f"{cfg.http.base_url}{cfg.http.api_prefix}",
        verdict=verdict,
        exit_code=exit_code,
        setup_complete=cache.get("setup_complete"),
        results=results,
        evidence=evidence,
        timings_ms=cache.get("timings_ms", {}),
        remediation_hints=hints,
    )
    return report, cache


def validate_target_url(cfg: Sec007Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
