# Human: SEC-002 test cases — demote admin, probe stale JWT on admin routes.
# Agent: HTTP via http_client; RETURNS AuditReport; mutates role then restores by default.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .constants_sec002 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC002,
    ROUTE_ADMIN_USERS,
    ROUTE_AUTH_LOGIN,
    ROUTE_SETUP_STATUS,
)
from .bootstrap_sec002 import (
    create_bootstrap_subject,
    delete_bootstrap_subject,
    generate_bootstrap_credentials,
)
from .evidence_sec002 import build_stale_admin_access_evidence
from .heuristics import json_get
from .heuristics_sec002 import (
    extract_login_token,
    find_user_id_by_email,
    login_user_id,
    login_user_role,
    patch_confirmed_role,
    response_indicates_admin_forbidden,
    response_indicates_admin_users_list,
)
from .http_client import api_url, http_get_with_retries, http_patch_json, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec002Config


def _cfg_http(cfg: Sec002Config):
    return cfg.http


def _auth_headers(token: str) -> dict[str, str]:
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
        remediation=REMEDIATION_SEC002,
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


def test_credentials_configured(cfg: Sec002Config, _cache: dict[str, Any]) -> CaseResult:
    missing: list[str] = []
    if not cfg.demoter_email:
        missing.append("demoter email")
    if not cfg.demoter_password:
        missing.append("demoter password")
    if not cfg.bootstrap_subject:
        if not cfg.subject_email:
            missing.append("subject email")
        if not cfg.subject_password:
            missing.append("subject password")
        if cfg.subject_email and cfg.demoter_email:
            if cfg.subject_email.strip().lower() == cfg.demoter_email.strip().lower():
                return CaseResult(
                    name="credentials_configured",
                    passed=False,
                    detail="subject and demoter must be different admin accounts",
                    severity="error",
                )
    if missing:
        return CaseResult(
            name="credentials_configured",
            passed=False,
            detail=f"missing: {', '.join(missing)} (CLI or SEC002_* env)",
            severity="error",
        )
    mode = "bootstrap (demoter only)" if cfg.bootstrap_subject else "subject + demoter"
    return CaseResult(
        name="credentials_configured",
        passed=True,
        detail=f"credentials configured ({mode})",
        severity="pass",
    )


def test_target_reachable(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
    http = _cfg_http(cfg)
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


def test_setup_complete(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
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
    if _cfg_http(cfg).require_setup_complete:
        return CaseResult(
            name="setup_complete_required",
            passed=False,
            detail=f"setup_complete={complete!r} — SEC002 requires a completed instance",
            severity="error",
        )
    return CaseResult(
        name="setup_complete_required",
        passed=True,
        detail=f"setup_complete={complete!r} (requirement relaxed)",
        severity="pass",
    )


def _login(
    cfg: Sec002Config,
    cache: dict[str, Any],
    *,
    cache_key: str,
    email: str,
    password: str,
    case_login: str,
    case_role: str,
) -> tuple[CaseResult | None, CaseResult | None]:
    http = _cfg_http(cfg)
    url = api_url(http, ROUTE_AUTH_LOGIN)
    res = http_post_json(http, url, {"email": email, "password": password})
    cache[cache_key] = res
    _record_timing(cache, cache_key, res)
    if res.error:
        return (
            CaseResult(
                name=case_login,
                passed=False,
                detail=f"POST {ROUTE_AUTH_LOGIN} failed: {res.error}",
                severity="error",
            ),
            None,
        )
    if res.status != 200:
        return (
            CaseResult(
                name=case_login,
                passed=False,
                detail=f"POST {ROUTE_AUTH_LOGIN} -> HTTP {res.status}",
                severity="error",
            ),
            None,
        )
    token = extract_login_token(res)
    if not token:
        return (
            CaseResult(
                name=case_login,
                passed=False,
                detail="login response missing token",
                severity="error",
            ),
            None,
        )
    cache[f"{cache_key}_token"] = token
    login_ok = CaseResult(
        name=case_login,
        passed=True,
        detail=f"authenticated as {email}",
        severity="pass",
    )
    role = login_user_role(res)
    if role != "admin":
        return (
            login_ok,
            CaseResult(
                name=case_role,
                passed=False,
                detail=f"expected role=admin, got {role!r}",
                severity="error",
            ),
        )
    cache[f"{cache_key}_user_id"] = login_user_id(res)
    return (
        login_ok,
        CaseResult(
            name=case_role,
            passed=True,
            detail="role=admin at login",
            severity="pass",
        ),
    )


def test_bootstrap_subject_created(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
    if not cfg.bootstrap_subject:
        return CaseResult(
            name="bootstrap_subject_created",
            passed=True,
            detail="skipped (not using --bootstrap-subject)",
            severity="pass",
        )
    demoter_token = cache.get("demoter_login_token")
    if not demoter_token:
        return CaseResult(
            name="bootstrap_subject_created",
            passed=False,
            detail="skipped (no demoter token)",
            severity="error",
        )
    email, password = generate_bootstrap_credentials()
    user_id, res = create_bootstrap_subject(cfg, demoter_token, email=email, password=password)
    cache["bootstrap_email"] = email
    cache["bootstrap_password"] = password
    cache["bootstrap_user_id"] = user_id
    if res.error:
        return CaseResult(
            name="bootstrap_subject_created",
            passed=False,
            detail=f"POST {ROUTE_ADMIN_USERS} failed: {res.error}",
            severity="error",
        )
    if res.status not in (200, 201) or not user_id:
        return CaseResult(
            name="bootstrap_subject_created",
            passed=False,
            detail=f"could not create temp subject admin (HTTP {res.status})",
            severity="error",
        )
    return CaseResult(
        name="bootstrap_subject_created",
        passed=True,
        detail=f"created {email}",
        severity="pass",
    )


def test_subject_login(cfg: Sec002Config, cache: dict[str, Any]) -> list[CaseResult]:
    email = cfg.subject_email or cache.get("bootstrap_email", "")
    password = cfg.subject_password or cache.get("bootstrap_password", "")
    a, b = _login(
        cfg,
        cache,
        cache_key="subject_login",
        email=email,
        password=password,
        case_login="subject_login",
        case_role="subject_is_admin",
    )
    out: list[CaseResult] = []
    if a:
        out.append(a)
    if b:
        out.append(b)
    return out


def test_demoter_login(cfg: Sec002Config, cache: dict[str, Any]) -> list[CaseResult]:
    a, b = _login(
        cfg,
        cache,
        cache_key="demoter_login",
        email=cfg.demoter_email,
        password=cfg.demoter_password,
        case_login="demoter_login",
        case_role="demoter_is_admin",
    )
    out: list[CaseResult] = []
    if a:
        out.append(a)
    if b:
        out.append(b)
    return out


def test_subject_admin_before_demotion(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
    http = _cfg_http(cfg)
    token = cache.get("subject_login_token")
    if not token:
        return CaseResult(
            name="subject_admin_before_demotion",
            passed=False,
            detail="skipped (no subject token)",
            severity="error",
        )
    url = api_url(http, cfg.admin_probe_route)
    res = http_get_with_retries(http, url, extra_headers=_auth_headers(token))
    cache["subject_probe_before"] = res
    _record_timing(cache, "subject_probe_before", res)
    if response_indicates_admin_users_list(res):
        return CaseResult(
            name="subject_admin_before_demotion",
            passed=True,
            detail=f"GET {cfg.admin_probe_route} -> HTTP 200 (admin list)",
            severity="pass",
        )
    return CaseResult(
        name="subject_admin_before_demotion",
        passed=False,
        detail=f"GET {cfg.admin_probe_route} -> HTTP {res.status} (expected admin access pre-demotion)",
        severity="error",
    )


def test_demotion_applied(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
    http = _cfg_http(cfg)
    demoter_token = cache.get("demoter_login_token")
    if not demoter_token:
        return CaseResult(
            name="demotion_applied",
            passed=False,
            detail="skipped (no demoter token)",
            severity="error",
        )
    list_url = api_url(http, ROUTE_ADMIN_USERS)
    list_res = http_get_with_retries(http, list_url, extra_headers=_auth_headers(demoter_token))
    subject_id = cache.get("subject_login_user_id") or find_user_id_by_email(
        list_res.body_json, cfg.subject_email
    )
    if not subject_id:
        return CaseResult(
            name="demotion_applied",
            passed=False,
            detail="cannot resolve subject user id for PATCH demotion",
            severity="error",
        )
    cache["subject_user_id"] = subject_id
    patch_url = api_url(http, f"{ROUTE_ADMIN_USERS}/{subject_id}")
    patch_res = http_patch_json(
        http,
        patch_url,
        {"role": cfg.demote_role},
        extra_headers=_auth_headers(demoter_token),
    )
    cache["demotion_patch"] = patch_res
    _record_timing(cache, "demotion_patch", patch_res)
    if patch_res.error:
        return CaseResult(
            name="demotion_applied",
            passed=False,
            detail=f"PATCH failed: {patch_res.error}",
            severity="error",
        )
    if patch_res.status == 403 and "last" in patch_res.body_text.lower():
        return CaseResult(
            name="demotion_applied",
            passed=False,
            detail="PATCH blocked — need at least two active admins (demoter must not be last admin)",
            severity="error",
        )
    if patch_res.status not in (200, 201):
        return CaseResult(
            name="demotion_applied",
            passed=False,
            detail=f"PATCH {ROUTE_ADMIN_USERS}/{{id}} -> HTTP {patch_res.status}",
            severity="error",
        )
    if not patch_confirmed_role(patch_res.body_json, cfg.demote_role):
        return CaseResult(
            name="demotion_applied",
            passed=False,
            detail=f"PATCH succeeded but role is not {cfg.demote_role!r}",
            severity="error",
        )
    return CaseResult(
        name="demotion_applied",
        passed=True,
        detail=f"role demoted to {cfg.demote_role!r} in database",
        severity="pass",
    )


def test_stale_jwt_admin_denied(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
    http = _cfg_http(cfg)
    token = cache.get("subject_login_token")
    if not token:
        return CaseResult(
            name="stale_jwt_admin_denied",
            passed=False,
            detail="skipped (no subject token)",
            severity="error",
        )
    url = api_url(http, cfg.admin_probe_route)
    res = http_get_with_retries(http, url, extra_headers=_auth_headers(token))
    cache["subject_probe_after"] = res
    _record_timing(cache, "subject_probe_after", res)
    if response_indicates_admin_forbidden(res):
        return CaseResult(
            name="stale_jwt_admin_denied",
            passed=True,
            detail=f"GET {cfg.admin_probe_route} -> HTTP {res.status} after demotion (fixed)",
            severity="pass",
        )
    if response_indicates_admin_users_list(res):
        cache["evidence_stale_admin"] = build_stale_admin_access_evidence(
            res,
            route=cfg.admin_probe_route,
            demoted_role=cfg.demote_role,
        )
        return fail_result(
            "stale_jwt_admin_denied",
            f"stale JWT still lists admin users (HTTP {res.status}) after demotion to {cfg.demote_role!r}",
            evidence_key="stale_admin",
        )
    return CaseResult(
        name="stale_jwt_admin_denied",
        passed=False,
        detail=f"unexpected HTTP {res.status} after demotion (expected 403/401 or safe denial)",
        severity="error",
    )


def test_bootstrap_subject_deleted(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
    if not cfg.bootstrap_subject:
        return CaseResult(
            name="bootstrap_subject_deleted",
            passed=True,
            detail="skipped (not bootstrap)",
            severity="pass",
        )
    demoter_token = cache.get("demoter_login_token")
    user_id = cache.get("bootstrap_user_id") or cache.get("subject_user_id")
    if not demoter_token or not user_id:
        return CaseResult(
            name="bootstrap_subject_deleted",
            passed=False,
            detail="cleanup skipped (missing demoter token or subject id)",
            severity="error",
        )
    res = delete_bootstrap_subject(cfg, demoter_token, user_id)
    if res.status in (200, 204):
        return CaseResult(
            name="bootstrap_subject_deleted",
            passed=True,
            detail="temporary subject admin deleted",
            severity="pass",
        )
    return CaseResult(
        name="bootstrap_subject_deleted",
        passed=False,
        detail=f"DELETE subject -> HTTP {res.status} (remove sec002-audit-*@audit.local manually)",
        severity="error",
    )


def test_admin_role_restored(cfg: Sec002Config, cache: dict[str, Any]) -> CaseResult:
    if cfg.bootstrap_subject:
        return CaseResult(
            name="admin_role_restored",
            passed=True,
            detail="skipped (bootstrap uses DELETE cleanup)",
            severity="pass",
        )
    if not cfg.restore_admin_role:
        return CaseResult(
            name="admin_role_restored",
            passed=True,
            detail="skipped (--no-restore / SEC002_NO_RESTORE)",
            severity="pass",
        )
    http = _cfg_http(cfg)
    demoter_token = cache.get("demoter_login_token")
    subject_id = cache.get("subject_user_id")
    if not demoter_token or not subject_id:
        return CaseResult(
            name="admin_role_restored",
            passed=False,
            detail="skipped restore (missing demoter token or subject id)",
            severity="error",
        )
    patch_url = api_url(http, f"{ROUTE_ADMIN_USERS}/{subject_id}")
    res = http_patch_json(
        http,
        patch_url,
        {"role": "admin"},
        extra_headers=_auth_headers(demoter_token),
    )
    _record_timing(cache, "restore_patch", res)
    if res.status in (200, 201) and patch_confirmed_role(res.body_json, "admin"):
        return CaseResult(
            name="admin_role_restored",
            passed=True,
            detail="subject role restored to admin",
            severity="pass",
        )
    return CaseResult(
        name="admin_role_restored",
        passed=False,
        detail=f"restore PATCH -> HTTP {res.status} (manual restore may be required)",
        severity="error",
    )


def test_exploit_primitive(_cfg: Sec002Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_stale_jwt",
        passed=True,
        detail="reuses subject JWT from before demotion (no re-login after PATCH)",
        severity="pass",
    )


def run_sec002_audit(cfg: Sec002Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    def append(result: CaseResult) -> bool:
        results.append(result)
        return cfg.http.fail_fast and not result.passed and result.severity == "fail"

    steps: list[tuple[str, Callable[[], CaseResult | list[CaseResult]]]] = [
        ("credentials", lambda: test_credentials_configured(cfg, cache)),
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup", lambda: test_setup_complete(cfg, cache)),
        ("demoter_auth", lambda: test_demoter_login(cfg, cache)),
        ("bootstrap", lambda: test_bootstrap_subject_created(cfg, cache)),
        ("subject_auth", lambda: test_subject_login(cfg, cache)),
        ("subject_pre", lambda: test_subject_admin_before_demotion(cfg, cache)),
        ("demote", lambda: test_demotion_applied(cfg, cache)),
        ("stale_probe", lambda: test_stale_jwt_admin_denied(cfg, cache)),
        ("restore", lambda: test_admin_role_restored(cfg, cache)),
        ("bootstrap_cleanup", lambda: test_bootstrap_subject_deleted(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
    ]

    for name, fn in steps:
        try:
            raw = fn()
        except Exception as exc:  # noqa: BLE001
            raw = CaseResult(
                name=name,
                passed=False,
                detail=f"unexpected error: {exc}",
                severity="error",
            )
        items = raw if isinstance(raw, list) else [raw]
        stop = False
        for item in items:
            if append(item):
                stop = True
                break
        if stop:
            break
        if name == "target" and results and not results[-1].passed and results[-1].severity == "error":
            break
        if name == "credentials" and results and not results[-1].passed:
            break
        if name in ("subject_auth", "demoter_auth", "bootstrap") and results and not results[-1].passed:
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
    if "evidence_stale_admin" in cache:
        evidence["stale_admin"] = cache["evidence_stale_admin"]

    hints: list[str] = []
    if fails:
        hints.append(REMEDIATION_SEC002)
        hints.append(AUDIT_LOG_HINT)

    http = _cfg_http(cfg)
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


def validate_target_url(cfg: Sec002Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
