# Human: SEC-005 — unauthenticated POST /setup and missing bootstrap-token gate.
# Agent: HTTP probes without Authorization; RETURNS AuditReport; safe invalid probe body only.

from __future__ import annotations

import secrets
from typing import Any, Callable
from urllib.parse import urlparse

from .constants_sec005 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC005,
    ROUTE_SETUP,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec005 import build_setup_probe_evidence
from .heuristics import json_get
from .heuristics_sec005 import (
    bootstrap_token_enforced,
    invalid_probe_processed_without_auth,
    responses_same_auth_outcome,
    setup_mutation_succeeded,
)
from .http_client import api_url, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec005Config

# Human: Intentionally invalid password — triggers 400 without completing setup.
# Agent: WRITES no DB user; safe on pre-setup instances.
_INVALID_PROBE_BODY: dict[str, Any] = {
    "email": "sec005-audit-probe@invalid.local",
    "password": "short",
    "instance_name": "SEC005 Audit Probe",
    "allow_public_registration": False,
}


def _http(cfg: Sec005Config):
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
        remediation=REMEDIATION_SEC005,
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


def _invalid_probe_body() -> dict[str, Any]:
    body = dict(_INVALID_PROBE_BODY)
    body["email"] = f"sec005-{secrets.token_hex(4)}@audit.invalid"
    return body


def test_target_reachable(cfg: Sec005Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_status_probe(cfg: Sec005Config, cache: dict[str, Any]) -> CaseResult:
    res: HttpResult = cache["setup_status"]
    if res.status >= 500:
        return CaseResult(
            name="setup_status_readable",
            passed=False,
            detail=f"server error HTTP {res.status}",
            severity="error",
        )
    complete = json_get(res.body_json, "setup_complete") if res.body_json else None
    cache["setup_complete"] = complete
    if _http(cfg).require_setup_complete and complete is not True:
        return CaseResult(
            name="setup_status_readable",
            passed=False,
            detail=f"setup_complete={complete!r} — SEC005_REQUIRE_SETUP_COMPLETE=1 needs true",
            severity="error",
        )
    return CaseResult(
        name="setup_status_readable",
        passed=True,
        detail=f"HTTP {res.status}, setup_complete={complete!r}",
        severity="pass",
    )


def test_exploit_primitive(_cfg: Sec005Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_unauthenticated",
        passed=True,
        detail="probes use no Authorization (unauthenticated attacker)",
        severity="pass",
    )


def test_setup_post_plain(cfg: Sec005Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    url = api_url(http, ROUTE_SETUP)
    body = _invalid_probe_body()
    res = http_post_json(http, url, body)
    cache["setup_post_plain"] = res
    cache["setup_probe_body"] = body
    _record_timing(cache, "setup_post_plain", res)
    if res.error:
        return CaseResult(
            name="setup_post_reachable_without_auth",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )
    if setup_mutation_succeeded(res):
        cache["evidence_setup"] = build_setup_probe_evidence(
            res, route=ROUTE_SETUP, title="Unauthenticated setup completion"
        )
        return fail_result(
            "setup_post_reachable_without_auth",
            f"POST {ROUTE_SETUP} completed setup without bootstrap auth (HTTP {res.status})",
            evidence_key="setup",
        )
    if invalid_probe_processed_without_auth(res):
        return CaseResult(
            name="setup_post_reachable_without_auth",
            passed=True,
            detail=f"POST {ROUTE_SETUP} reachable without credentials (HTTP {res.status})",
            severity="pass",
        )
    if bootstrap_token_enforced(res):
        return CaseResult(
            name="setup_post_reachable_without_auth",
            passed=True,
            detail=f"POST gated (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="setup_post_reachable_without_auth",
        passed=False,
        detail=f"unexpected HTTP {res.status}",
        severity="error",
    )


def test_bootstrap_token_not_enforced(cfg: Sec005Config, cache: dict[str, Any]) -> CaseResult:
    res: HttpResult = cache.get("setup_post_plain") or HttpResult(0, {}, "", None)
    if res.error:
        return CaseResult(
            name="bootstrap_token_not_enforced",
            passed=False,
            detail="skipped (setup POST failed)",
            severity="error",
        )
    if bootstrap_token_enforced(res):
        return CaseResult(
            name="bootstrap_token_not_enforced",
            passed=True,
            detail=f"bootstrap credential required (HTTP {res.status})",
            severity="pass",
        )
    if invalid_probe_processed_without_auth(res):
        cache["evidence_setup"] = build_setup_probe_evidence(
            res, route=ROUTE_SETUP, title="Missing bootstrap token gate"
        )
        return fail_result(
            "bootstrap_token_not_enforced",
            f"POST {ROUTE_SETUP} processed without bootstrap secret (HTTP {res.status})",
            evidence_key="setup",
        )
    return CaseResult(
        name="bootstrap_token_not_enforced",
        passed=False,
        detail=f"unexpected HTTP {res.status}",
        severity="error",
    )


def test_invalid_bootstrap_header(cfg: Sec005Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    url = api_url(http, ROUTE_SETUP)
    header_name = cfg.bootstrap_header
    body = _invalid_probe_body()
    res = http_post_json(
        http,
        url,
        body,
        extra_headers={header_name: "sec005-invalid-bootstrap-token"},
    )
    cache["setup_post_with_token"] = res
    _record_timing(cache, "setup_post_with_token", res)
    plain: HttpResult = cache.get("setup_post_plain") or HttpResult(0, {}, "", None)
    if res.error:
        return CaseResult(
            name="invalid_bootstrap_token_not_rejected",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )
    if bootstrap_token_enforced(res) and not bootstrap_token_enforced(plain):
        return CaseResult(
            name="invalid_bootstrap_token_not_rejected",
            passed=True,
            detail=f"invalid {header_name} rejected (HTTP {res.status})",
            severity="pass",
        )
    if bootstrap_token_enforced(res):
        return CaseResult(
            name="invalid_bootstrap_token_not_rejected",
            passed=True,
            detail=f"bootstrap header enforced (HTTP {res.status})",
            severity="pass",
        )
    if responses_same_auth_outcome(plain, res) and invalid_probe_processed_without_auth(res):
        cache["evidence_setup_token"] = build_setup_probe_evidence(
            res,
            route=f"{ROUTE_SETUP} (+{header_name})",
            title="Invalid bootstrap header ignored",
        )
        return fail_result(
            "invalid_bootstrap_token_not_rejected",
            f"bogus {header_name} ignored — same outcome as no header (HTTP {res.status})",
            evidence_key="setup_token",
        )
    return CaseResult(
        name="invalid_bootstrap_token_not_rejected",
        passed=True,
        detail=f"header probe HTTP {res.status} (differs from plain POST)",
        severity="pass",
    )


def test_setup_public_while_incomplete(cfg: Sec005Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not False:
        return CaseResult(
            name="setup_public_while_incomplete",
            passed=True,
            detail="skipped (instance already initialized)",
            severity="pass",
        )
    res: HttpResult = cache.get("setup_post_plain") or HttpResult(0, {}, "", None)
    if bootstrap_token_enforced(res):
        return CaseResult(
            name="setup_public_while_incomplete",
            passed=True,
            detail="pre-setup POST rejected without bootstrap token",
            severity="pass",
        )
    if res.status == 400:
        return fail_result(
            "setup_public_while_incomplete",
            "fresh instance accepts unauthenticated setup mutation (HTTP 400 validation only)",
            evidence_key="setup",
        )
    if setup_mutation_succeeded(res):
        return fail_result(
            "setup_public_while_incomplete",
            "fresh instance allowed unauthenticated setup completion",
            evidence_key="setup",
        )
    return CaseResult(
        name="setup_public_while_incomplete",
        passed=False,
        detail=f"unexpected pre-setup POST HTTP {res.status}",
        severity="error",
    )


def test_setup_blocked_after_complete(cfg: Sec005Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="setup_blocked_after_complete",
            passed=True,
            detail="skipped (pre-setup)",
            severity="pass",
        )
    res: HttpResult = cache.get("setup_post_plain") or HttpResult(0, {}, "", None)
    if res.status == 409:
        return CaseResult(
            name="setup_blocked_after_complete",
            passed=True,
            detail="POST /setup returns 409 after initialization",
            severity="pass",
        )
    if bootstrap_token_enforced(res):
        return CaseResult(
            name="setup_blocked_after_complete",
            passed=True,
            detail=f"POST blocked (HTTP {res.status})",
            severity="pass",
        )
    if setup_mutation_succeeded(res):
        return fail_result(
            "setup_blocked_after_complete",
            f"POST /setup still completes on initialized instance (HTTP {res.status})",
            evidence_key="setup",
        )
    return CaseResult(
        name="setup_blocked_after_complete",
        passed=False,
        detail=f"expected 409 or auth gate, got HTTP {res.status}",
        severity="error",
    )


def test_concurrent_setup_race(_cfg: Sec005Config, _cache: dict[str, Any]) -> CaseResult:
    # Human: Live race requires two successful setups on empty DB — not run by default.
    # Agent: DOCUMENTS manual verification; RETURNS skip pass.
    return CaseResult(
        name="concurrent_setup_race",
        passed=True,
        detail="skipped — verify manually on fresh DB with concurrent POST /setup (see security-audit.md)",
        severity="pass",
    )


def run_sec005_audit(cfg: Sec005Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup_status", lambda: test_setup_status_probe(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
        ("setup_post", lambda: test_setup_post_plain(cfg, cache)),
        ("bootstrap", lambda: test_bootstrap_token_not_enforced(cfg, cache)),
        ("header", lambda: test_invalid_bootstrap_header(cfg, cache)),
        ("incomplete", lambda: test_setup_public_while_incomplete(cfg, cache)),
        ("blocked", lambda: test_setup_blocked_after_complete(cfg, cache)),
        ("race", lambda: test_concurrent_setup_race(cfg, cache)),
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
    if "evidence_setup" in cache:
        evidence["setup"] = cache["evidence_setup"]
    if "evidence_setup_token" in cache:
        evidence["setup_token"] = cache["evidence_setup_token"]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC005)
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


def validate_target_url(cfg: Sec005Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
