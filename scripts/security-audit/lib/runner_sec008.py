# Human: SEC-008 — unauthenticated POST /setup/storage/test SSRF / internal recon.
# Agent: HTTP probes without Authorization; RETURNS AuditReport.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .constants_sec008 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC008,
    ROUTE_SETUP_STATUS,
    ROUTE_SETUP_STORAGE_TEST,
)
from .evidence_sec008 import build_storage_probe_evidence
from .heuristics import json_get
from .heuristics_sec008 import (
    ssrf_probe_vulnerable,
    storage_test_auth_required,
    storage_test_setup_complete_block,
    unauthenticated_storage_probe_accepted,
)
from .http_client import api_url, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, HttpResult, Sec008Config


def _http(cfg: Sec008Config):
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
        remediation=REMEDIATION_SEC008,
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


def _post_storage_test(cfg: Sec008Config, base_url: str) -> HttpResult:
    http = _http(cfg)
    return http_post_json(
        http,
        api_url(http, ROUTE_SETUP_STORAGE_TEST),
        {"base_url": base_url},
    )


def test_target_reachable(cfg: Sec008Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_status_probe(cfg: Sec008Config, cache: dict[str, Any]) -> CaseResult:
    res: HttpResult = cache["setup_status"]
    complete = json_get(res.body_json, "setup_complete") if res.body_json else None
    cache["setup_complete"] = complete
    return CaseResult(
        name="setup_status_readable",
        passed=True,
        detail=f"HTTP {res.status}, setup_complete={complete!r}",
        severity="pass",
    )


def test_exploit_primitive(_cfg: Sec008Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_unauthenticated",
        passed=True,
        detail=f"probes POST {ROUTE_SETUP_STORAGE_TEST} without Authorization",
        severity="pass",
    )


def test_pre_setup_required(cfg: Sec008Config, cache: dict[str, Any]) -> CaseResult:
    complete = cache.get("setup_complete")
    if complete is True:
        if cfg.require_pre_setup:
            return CaseResult(
                name="pre_setup_required_for_ssrf_probe",
                passed=False,
                detail="setup_complete=true — use uninitialized instance or fresh DB to test SSRF",
                severity="error",
            )
        return CaseResult(
            name="pre_setup_required_for_ssrf_probe",
            passed=True,
            detail="setup_complete=true — SSRF probes skipped; post-setup gating checked",
            severity="pass",
        )
    if complete is False:
        return CaseResult(
            name="pre_setup_required_for_ssrf_probe",
            passed=True,
            detail="setup_complete=false (pre-setup SSRF probe applicable)",
            severity="pass",
        )
    return CaseResult(
        name="pre_setup_required_for_ssrf_probe",
        passed=True,
        detail="setup status unknown — continuing",
        severity="pass",
    )


def test_post_setup_gated(cfg: Sec008Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="post_setup_storage_test_gated",
            passed=True,
            detail="skipped (pre-setup)",
            severity="pass",
        )
    label, url = cfg.probe_targets[0]
    res = _post_storage_test(cfg, url)
    cache["post_setup_probe"] = res
    _record_timing(cache, "post_setup_probe", res)
    if storage_test_setup_complete_block(res):
        return CaseResult(
            name="post_setup_storage_test_gated",
            passed=True,
            detail=f"storage test blocked after setup (HTTP {res.status}, {label})",
            severity="pass",
        )
    if storage_test_auth_required(res):
        return CaseResult(
            name="post_setup_storage_test_gated",
            passed=True,
            detail=f"storage test requires auth after setup (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="post_setup_storage_test_gated",
        passed=False,
        detail=f"expected 409/401 after setup, got HTTP {res.status}",
        severity="error",
    )


def test_storage_test_public_pre_setup(cfg: Sec008Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not False:
        return CaseResult(
            name="storage_test_public_pre_setup",
            passed=True,
            detail="skipped (not pre-setup)",
            severity="pass",
        )
    label, url = cfg.probe_targets[0]
    res = _post_storage_test(cfg, url)
    cache["pre_setup_probe"] = res
    if storage_test_auth_required(res):
        return CaseResult(
            name="storage_test_public_pre_setup",
            passed=True,
            detail="storage test requires bootstrap auth",
            severity="pass",
        )
    if unauthenticated_storage_probe_accepted(res):
        return CaseResult(
            name="storage_test_public_pre_setup",
            passed=True,
            detail=f"unauthenticated storage test accepted (HTTP {res.status}, {label})",
            severity="pass",
        )
    return CaseResult(
        name="storage_test_public_pre_setup",
        passed=False,
        detail=f"unexpected HTTP {res.status}",
        severity="error",
    )


def test_internal_targets_not_blocked(cfg: Sec008Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not False:
        return CaseResult(
            name="internal_targets_not_blocked",
            passed=True,
            detail="skipped (not pre-setup)",
            severity="pass",
        )
    vulnerable: list[str] = []
    probe_results: dict[str, HttpResult] = {}
    for label, url in cfg.probe_targets:
        res = _post_storage_test(cfg, url)
        probe_results[label] = res
        _record_timing(cache, f"probe_{label}", res)
        if res.error:
            return CaseResult(
                name="internal_targets_not_blocked",
                passed=False,
                detail=f"probe {label} failed: {res.error}",
                severity="error",
            )
        if ssrf_probe_vulnerable(res):
            vulnerable.append(label)
    cache["probe_results"] = probe_results
    if vulnerable:
        first = vulnerable[0]
        cache["evidence_storage_probe"] = build_storage_probe_evidence(
            probe_results[first],
            route=ROUTE_SETUP_STORAGE_TEST,
            title="Internal storage URL accepted",
            target_label=first,
        )
        return fail_result(
            "internal_targets_not_blocked",
            f"internal/metadata URLs not rejected: {', '.join(vulnerable)}",
            evidence_key="storage_probe",
        )
    return CaseResult(
        name="internal_targets_not_blocked",
        passed=True,
        detail="all internal probe targets rejected or auth-gated",
        severity="pass",
    )


def run_sec008_audit(cfg: Sec008Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup_status", lambda: test_setup_status_probe(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
        ("pre_setup", lambda: test_pre_setup_required(cfg, cache)),
        ("post_setup", lambda: test_post_setup_gated(cfg, cache)),
        ("public", lambda: test_storage_test_public_pre_setup(cfg, cache)),
        ("internal", lambda: test_internal_targets_not_blocked(cfg, cache)),
    ]

    for name, fn in steps:
        result = run_case(name, fn)
        results.append(result)
        if result.severity == "error" and name == "target":
            break
        if result.severity == "error" and name == "pre_setup":
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
    if "evidence_storage_probe" in cache:
        evidence["storage_probe"] = cache["evidence_storage_probe"]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC008)
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


def validate_target_url(cfg: Sec008Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
