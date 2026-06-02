# Human: SEC-006 — login/register rate limit trusts spoofable forwarding headers.
# Agent: HTTP burst probes with fixed vs rotated X-Forwarded-For / X-Real-IP; RETURNS AuditReport.

from __future__ import annotations

import secrets
from typing import Any, Callable
from urllib.parse import urlparse

from .constants_sec006 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    HEADER_FORWARDED_FOR,
    HEADER_REAL_IP,
    REMEDIATION_SEC006,
    ROUTE_AUTH_LOGIN,
    ROUTE_AUTH_REGISTER,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec006 import build_rate_limit_evidence
from .heuristics import json_get
from .heuristics_sec006 import (
    count_rate_limited,
    header_rotation_bypasses_limit,
    single_key_enforces_limit,
)
from .http_client import api_url, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec006Config

# Human: RFC 5737 documentation prefix — distinct keys for rotation probes.
_IP_PREFIX = "203.0.113."


def _http(cfg: Sec006Config):
    return cfg.http


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
        remediation=REMEDIATION_SEC006,
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


def _login_body() -> dict[str, str]:
    # Human: Wrong password — always 401 after rate limit; no valid session issued.
    return {
        "email": f"sec006-audit-{secrets.token_hex(4)}@invalid.local",
        "password": "sec006-wrong-password-not-valid",
    }


def _register_body() -> dict[str, str]:
    # Human: Invalid email — 400 after rate limit; avoids creating users when registration is on.
    return {
        "email": "not-an-email",
        "password": "sec006-wrong-password-not-valid",
    }


def _burst_login(
    cfg: Sec006Config,
    *,
    attempts: int,
    header_name: str | None,
    ip_for_header: Callable[[int], str],
) -> list[HttpResult]:
    http = _http(cfg)
    url = api_url(http, ROUTE_AUTH_LOGIN)
    results: list[HttpResult] = []
    body = _login_body()
    for i in range(attempts):
        extra: dict[str, str] | None = None
        if header_name:
            extra = {header_name: ip_for_header(i)}
        results.append(http_post_json(http, url, body, extra_headers=extra))
    return results


def _burst_register(
    cfg: Sec006Config,
    *,
    attempts: int,
    header_name: str | None,
    ip_for_header: Callable[[int], str],
) -> list[HttpResult]:
    http = _http(cfg)
    url = api_url(http, ROUTE_AUTH_REGISTER)
    results: list[HttpResult] = []
    body = _register_body()
    for i in range(attempts):
        extra: dict[str, str] | None = None
        if header_name:
            extra = {header_name: ip_for_header(i)}
        results.append(http_post_json(http, url, body, extra_headers=extra))
    return results


def test_target_reachable(cfg: Sec006Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_complete(cfg: Sec006Config, cache: dict[str, Any]) -> CaseResult:
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
            detail=f"setup_complete={complete!r} — login probe needs initialized instance",
            severity="error",
        )
    return CaseResult(
        name="setup_complete_required",
        passed=True,
        detail=f"setup_complete={complete!r} (continuing)",
        severity="pass",
    )


def test_exploit_primitive(_cfg: Sec006Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_spoofed_ip_headers",
        passed=True,
        detail=f"probes spoof {HEADER_FORWARDED_FOR} and {HEADER_REAL_IP} per attempt",
        severity="pass",
    )


def test_login_rate_limit_single_ip(cfg: Sec006Config, cache: dict[str, Any]) -> CaseResult:
    attempts = cfg.login_rpm + 1
    fixed_ip = f"{_IP_PREFIX}50"
    results = _burst_login(
        cfg,
        attempts=attempts,
        header_name=HEADER_FORWARDED_FOR,
        ip_for_header=lambda _i: fixed_ip,
    )
    cache["login_fixed_xff"] = results
    if any(r.error for r in results):
        return CaseResult(
            name="login_rate_limit_enforced_single_ip",
            passed=False,
            detail="one or more login requests failed to connect",
            severity="error",
        )
    if single_key_enforces_limit(results):
        return CaseResult(
            name="login_rate_limit_enforced_single_ip",
            passed=True,
            detail=f"{count_rate_limited(results)}/{attempts} throttled with fixed {HEADER_FORWARDED_FOR}",
            severity="pass",
        )
    return CaseResult(
        name="login_rate_limit_enforced_single_ip",
        passed=False,
        detail=f"no 429 after {attempts} login attempts (expected cap {cfg.login_rpm}/min)",
        severity="error",
    )


def test_login_bypass_forwarded_for(cfg: Sec006Config, cache: dict[str, Any]) -> CaseResult:
    fixed: list[HttpResult] = cache.get("login_fixed_xff") or []
    if not single_key_enforces_limit(fixed):
        return CaseResult(
            name="login_bypass_via_forwarded_for_rotation",
            passed=False,
            detail="skipped (fixed IP did not hit rate limit)",
            severity="error",
        )
    attempts = cfg.login_rpm + 1
    rotated = _burst_login(
        cfg,
        attempts=attempts,
        header_name=HEADER_FORWARDED_FOR,
        ip_for_header=lambda i: f"{_IP_PREFIX}{i + 1}",
    )
    cache["login_rotated_xff"] = rotated
    if any(r.error for r in rotated):
        return CaseResult(
            name="login_bypass_via_forwarded_for_rotation",
            passed=False,
            detail="rotated login burst failed to connect",
            severity="error",
        )
    if header_rotation_bypasses_limit(fixed, rotated):
        cache["evidence_login_xff"] = build_rate_limit_evidence(
            rotated,
            route=ROUTE_AUTH_LOGIN,
            title="Login X-Forwarded-For rotation bypass",
            header_mode="rotated X-Forwarded-For",
        )
        return fail_result(
            "login_bypass_via_forwarded_for_rotation",
            f"rotation avoided throttling ({count_rate_limited(rotated)}/{attempts} vs "
            f"{count_rate_limited(fixed)}/{attempts} fixed)",
            evidence_key="login_xff",
        )
    return CaseResult(
        name="login_bypass_via_forwarded_for_rotation",
        passed=True,
        detail="rotated headers still throttled (or peer IP used)",
        severity="pass",
    )


def test_login_bypass_x_real_ip(cfg: Sec006Config, cache: dict[str, Any]) -> CaseResult:
    attempts = cfg.login_rpm + 1
    fixed_ip = f"{_IP_PREFIX}60"
    fixed = _burst_login(
        cfg,
        attempts=attempts,
        header_name=HEADER_REAL_IP,
        ip_for_header=lambda _i: fixed_ip,
    )
    cache["login_fixed_real_ip"] = fixed
    if not single_key_enforces_limit(fixed):
        return CaseResult(
            name="login_bypass_via_x_real_ip_rotation",
            passed=False,
            detail="skipped (fixed X-Real-IP did not hit rate limit)",
            severity="error",
        )
    rotated = _burst_login(
        cfg,
        attempts=attempts,
        header_name=HEADER_REAL_IP,
        ip_for_header=lambda i: f"{_IP_PREFIX}{100 + i}",
    )
    cache["login_rotated_real_ip"] = rotated
    if header_rotation_bypasses_limit(fixed, rotated):
        cache["evidence_login_real_ip"] = build_rate_limit_evidence(
            rotated,
            route=ROUTE_AUTH_LOGIN,
            title="Login X-Real-IP rotation bypass",
            header_mode="rotated X-Real-IP",
        )
        return fail_result(
            "login_bypass_via_x_real_ip_rotation",
            f"{HEADER_REAL_IP} rotation avoided throttling "
            f"({count_rate_limited(rotated)}/{attempts} vs {count_rate_limited(fixed)}/{attempts} fixed)",
            evidence_key="login_real_ip",
        )
    return CaseResult(
        name="login_bypass_via_x_real_ip_rotation",
        passed=True,
        detail=f"{HEADER_REAL_IP} rotation still throttled",
        severity="pass",
    )


def test_register_rate_limit_single_ip(cfg: Sec006Config, cache: dict[str, Any]) -> CaseResult:
    if not cfg.probe_register:
        return CaseResult(
            name="register_rate_limit_enforced_single_ip",
            passed=True,
            detail="skipped (--skip-register)",
            severity="pass",
        )
    attempts = cfg.register_rpm + 1
    fixed_ip = f"{_IP_PREFIX}70"
    results = _burst_register(
        cfg,
        attempts=attempts,
        header_name=HEADER_FORWARDED_FOR,
        ip_for_header=lambda _i: fixed_ip,
    )
    cache["register_fixed_xff"] = results
    if any(r.error for r in results):
        return CaseResult(
            name="register_rate_limit_enforced_single_ip",
            passed=False,
            detail="register burst failed to connect",
            severity="error",
        )
    if single_key_enforces_limit(results):
        return CaseResult(
            name="register_rate_limit_enforced_single_ip",
            passed=True,
            detail=f"{count_rate_limited(results)}/{attempts} throttled (register, fixed IP)",
            severity="pass",
        )
    return CaseResult(
        name="register_rate_limit_enforced_single_ip",
        passed=False,
        detail=f"no register 429 after {attempts} attempts (cap {cfg.register_rpm}/min)",
        severity="error",
    )


def test_register_bypass_forwarded_for(cfg: Sec006Config, cache: dict[str, Any]) -> CaseResult:
    if not cfg.probe_register:
        return CaseResult(
            name="register_bypass_via_forwarded_for_rotation",
            passed=True,
            detail="skipped (--skip-register)",
            severity="pass",
        )
    fixed: list[HttpResult] = cache.get("register_fixed_xff") or []
    if not single_key_enforces_limit(fixed):
        return CaseResult(
            name="register_bypass_via_forwarded_for_rotation",
            passed=False,
            detail="skipped (fixed register IP did not hit rate limit)",
            severity="error",
        )
    attempts = cfg.register_rpm + 1
    rotated = _burst_register(
        cfg,
        attempts=attempts,
        header_name=HEADER_FORWARDED_FOR,
        ip_for_header=lambda i: f"{_IP_PREFIX}{200 + i}",
    )
    if header_rotation_bypasses_limit(fixed, rotated):
        cache["evidence_register_xff"] = build_rate_limit_evidence(
            rotated,
            route=ROUTE_AUTH_REGISTER,
            title="Register X-Forwarded-For rotation bypass",
            header_mode="rotated X-Forwarded-For",
        )
        return fail_result(
            "register_bypass_via_forwarded_for_rotation",
            f"register rotation avoided throttling ({count_rate_limited(rotated)}/{attempts})",
            evidence_key="register_xff",
        )
    return CaseResult(
        name="register_bypass_via_forwarded_for_rotation",
        passed=True,
        detail="register rotation still throttled",
        severity="pass",
    )


def run_sec006_audit(cfg: Sec006Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup", lambda: test_setup_complete(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
        ("login_fixed", lambda: test_login_rate_limit_single_ip(cfg, cache)),
        ("login_xff", lambda: test_login_bypass_forwarded_for(cfg, cache)),
        ("login_real", lambda: test_login_bypass_x_real_ip(cfg, cache)),
        ("reg_fixed", lambda: test_register_rate_limit_single_ip(cfg, cache)),
        ("reg_xff", lambda: test_register_bypass_forwarded_for(cfg, cache)),
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
    for key in (
        "evidence_login_xff",
        "evidence_login_real_ip",
        "evidence_register_xff",
    ):
        if key in cache:
            evidence[key.removeprefix("evidence_")] = cache[key]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC006)
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


def validate_target_url(cfg: Sec006Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
