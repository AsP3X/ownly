# Human: SEC-009 — share password brute-force throttling on public share routes.
# Agent: HTTP burst of wrong x-share-password; RETURNS AuditReport.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .bootstrap_sec003 import public_route
from .bootstrap_sec009 import prepare_fixtures
from .constants_sec009 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    HEADER_SHARE_PASSWORD,
    REMEDIATION_SEC009,
    ROUTE_AUTH_LOGIN,
    ROUTE_PUBLIC_CONTENTS,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec009 import build_burst_evidence
from .heuristics import json_get
from .heuristics_sec003 import extract_login_token
from .heuristics_sec006 import is_rate_limited
from .heuristics_sec009 import (
    brute_force_unthrottled,
    count_forbidden_wrong_password,
    count_rate_limited,
    public_contents_granted,
    wrong_share_password_rejected,
)
from .http_client import api_url, http_delete, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec009Config

_IP_PREFIX = "203.0.113."


def _http(cfg: Sec009Config):
    return cfg.http


def _owner_auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _share_password_header(password: str) -> dict[str, str]:
    return {HEADER_SHARE_PASSWORD: password}


def _contents_url(cfg: Sec009Config, share_token: str) -> str:
    return api_url(cfg.http, public_route(ROUTE_PUBLIC_CONTENTS, token=share_token))


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
        remediation=REMEDIATION_SEC009,
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


def _burst_wrong_passwords(
    cfg: Sec009Config,
    share_token: str,
    *,
    attempts: int,
    extra_headers: dict[str, str] | None = None,
) -> list[HttpResult]:
    http = _http(cfg)
    url = _contents_url(cfg, share_token)
    results: list[HttpResult] = []
    for i in range(attempts):
        guess = f"sec009-wrong-{i:02d}"
        headers = _share_password_header(guess)
        if extra_headers:
            headers = {**headers, **extra_headers}
        results.append(http_get_with_retries(http, url, extra_headers=headers))
    return results


def test_credentials_configured(cfg: Sec009Config, _cache: dict[str, Any]) -> CaseResult:
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


def test_target_reachable(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_complete(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
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


def test_owner_login(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    res = http_post_json(
        http,
        api_url(http, ROUTE_AUTH_LOGIN),
        {"email": cfg.owner_email, "password": cfg.owner_password},
    )
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


def test_fixtures_ready(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
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
        detail="password-protected share ready",
        severity="pass",
    )


def test_share_password_gate_active(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="share_password_gate_active",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    res = _burst_wrong_passwords(cfg, share_token, attempts=1)[0]
    if wrong_share_password_rejected(res):
        return CaseResult(
            name="share_password_gate_active",
            passed=True,
            detail="wrong x-share-password rejected (HTTP 403)",
            severity="pass",
        )
    return CaseResult(
        name="share_password_gate_active",
        passed=False,
        detail=f"expected 403 incorrect password, got HTTP {res.status}",
        severity="error",
    )


def test_correct_password_still_works(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="correct_password_still_works",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    http = _http(cfg)
    res = http_get_with_retries(
        http,
        _contents_url(cfg, share_token),
        extra_headers=_share_password_header(cfg.share_password),
    )
    if public_contents_granted(res):
        return CaseResult(
            name="correct_password_still_works",
            passed=True,
            detail="correct password grants /contents",
            severity="pass",
        )
    if is_rate_limited(res):
        return CaseResult(
            name="correct_password_still_works",
            passed=False,
            detail="correct password blocked by rate limit — reduce --wrong-attempts or wait",
            severity="error",
        )
    return CaseResult(
        name="correct_password_still_works",
        passed=False,
        detail=f"correct password unexpected (HTTP {res.status})",
        severity="error",
    )


def test_exploit_primitive(_cfg: Sec009Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_guessed_passwords",
        passed=True,
        detail=f"many unique wrong {HEADER_SHARE_PASSWORD} values on public share route",
        severity="pass",
    )


def test_wrong_password_burst_not_throttled(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="wrong_password_burst_not_throttled",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    results = _burst_wrong_passwords(cfg, share_token, attempts=cfg.wrong_attempts)
    cache["burst_fixed"] = results
    if any(r.error for r in results):
        return CaseResult(
            name="wrong_password_burst_not_throttled",
            passed=False,
            detail="burst request failed",
            severity="error",
        )
    min_forbidden = min(8, max(3, cfg.wrong_attempts - 2))
    if brute_force_unthrottled(results, min_forbidden=min_forbidden):
        cache["evidence_burst"] = build_burst_evidence(
            results,
            route=public_route(ROUTE_PUBLIC_CONTENTS, token=share_token),
            title="Wrong password burst without throttling",
            mode="unique wrong passwords",
        )
        return fail_result(
            "wrong_password_burst_not_throttled",
            f"{count_forbidden_wrong_password(results)}/{cfg.wrong_attempts} returned 403, "
            f"0 rate-limited",
            evidence_key="burst",
        )
    if count_rate_limited(results) > 0:
        return CaseResult(
            name="wrong_password_burst_not_throttled",
            passed=True,
            detail=f"throttling observed ({count_rate_limited(results)} HTTP 429)",
            severity="pass",
        )
    return CaseResult(
        name="wrong_password_burst_not_throttled",
        passed=False,
        detail="unexpected burst outcome",
        severity="error",
    )


def test_forwarded_for_rotation_not_throttled(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
    share_token = cache.get("share_token")
    if not isinstance(share_token, str) or not share_token:
        return CaseResult(
            name="forwarded_for_rotation_not_throttled",
            passed=False,
            detail="skipped (no share token)",
            severity="error",
        )
    fixed = cache.get("burst_fixed") or []
    if not brute_force_unthrottled(fixed, min_forbidden=min(8, max(3, cfg.wrong_attempts - 2))):
        return CaseResult(
            name="forwarded_for_rotation_not_throttled",
            passed=True,
            detail="skipped (fixed burst already throttled)",
            severity="pass",
        )
    rotated: list[HttpResult] = []
    for i in range(cfg.wrong_attempts):
        rotated.extend(
            _burst_wrong_passwords(
                cfg,
                share_token,
                attempts=1,
                extra_headers={"X-Forwarded-For": f"{_IP_PREFIX}{i + 1}"},
            )
        )
    if brute_force_unthrottled(rotated, min_forbidden=min(8, max(3, cfg.wrong_attempts - 2))):
        return fail_result(
            "forwarded_for_rotation_not_throttled",
            f"rotating X-Forwarded-For still allowed {count_forbidden_wrong_password(rotated)} "
            f"wrong-password attempts without 429",
        )
    return CaseResult(
        name="forwarded_for_rotation_not_throttled",
        passed=True,
        detail="rotation burst throttled or blocked",
        severity="pass",
    )


def test_revoke_share(cfg: Sec009Config, cache: dict[str, Any]) -> CaseResult:
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
    res = http_delete(
        _http(cfg),
        api_url(cfg.http, f"/shares/{share_id}"),
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


def run_sec009_audit(cfg: Sec009Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("credentials", lambda: test_credentials_configured(cfg, cache)),
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup", lambda: test_setup_complete(cfg, cache)),
        ("login", lambda: test_owner_login(cfg, cache)),
        ("fixtures", lambda: test_fixtures_ready(cfg, cache)),
        ("gate", lambda: test_share_password_gate_active(cfg, cache)),
        ("correct", lambda: test_correct_password_still_works(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
        ("burst", lambda: test_wrong_password_burst_not_throttled(cfg, cache)),
        ("xff", lambda: test_forwarded_for_rotation_not_throttled(cfg, cache)),
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
    if "evidence_burst" in cache:
        evidence["burst"] = cache["evidence_burst"]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC009)
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


def validate_target_url(cfg: Sec009Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
