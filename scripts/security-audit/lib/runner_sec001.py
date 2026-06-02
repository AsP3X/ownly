# Human: SEC-001 test cases and audit orchestration.
# Agent: HTTP probes via http_client; RETURNS AuditReport; no app imports.

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlparse

from .constants import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    REMEDIATION_SEC001,
    ROUTE_SETUP_DATABASE,
    ROUTE_SETUP_DATABASE_TEST,
    ROUTE_SETUP_STATUS,
    ROUTE_SETUP_STORAGE,
    ROUTE_SETUP_STORAGE_TEST,
)
from .evidence import build_database_evidence, build_storage_evidence
from .heuristics import (
    GENERIC_USER_PASS_AT,
    USER_PASS_IN_AUTHORITY,
    body_contains_credential_material,
    database_response_is_fixed,
    is_blocked_status,
    json_get,
    looks_redacted,
    storage_exposed_keys,
    storage_response_is_fixed,
)
from .http_client import api_url, http_get_with_retries, http_post_json
from .models import AuditReport, CaseResult, Config, HttpResult

BOGUS_AUTH = {"Authorization": "Bearer sec001-audit-bogus-token-not-valid"}


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
        remediation=REMEDIATION_SEC001,
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


def test_target_reachable(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_STATUS)
    res = http_get_with_retries(cfg, url)
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


def test_setup_status_probe(cfg: Config, cache: dict[str, Any]) -> CaseResult:
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
    detail = f"HTTP {res.status}, setup_complete={complete!r}"
    if cfg.require_setup_complete and complete is not True:
        return CaseResult(
            name="setup_status_post_setup",
            passed=False,
            detail=f"{detail} — SEC001_REQUIRE_SETUP=1 requires setup_complete=true",
            severity="error",
        )
    return CaseResult(name="setup_status_readable", passed=True, detail=detail, severity="pass")


def test_database_endpoint(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_DATABASE)
    res = http_get_with_retries(cfg, url)
    cache["database"] = res
    _record_timing(cache, "database", res)
    if res.error:
        return CaseResult(
            name="database_no_credential_disclosure",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )
    setup_complete = cache.get("setup_complete")
    if is_blocked_status(res.status):
        return CaseResult(
            name="database_endpoint_blocked_or_removed",
            passed=True,
            detail=f"HTTP {res.status} (not publicly readable)",
            severity="pass",
        )
    if res.status >= 500:
        return CaseResult(
            name="database_no_credential_disclosure",
            passed=False,
            detail=f"HTTP {res.status} — server error",
            severity="error",
        )
    strict = cfg.strict_heuristics
    findings = body_contains_credential_material(res.body_text, strict=strict)
    db_url = json_get(res.body_json, "database_url") if res.body_json else None
    driver = json_get(res.body_json, "driver") if res.body_json else None
    if isinstance(db_url, str) and db_url.strip() and not looks_redacted(db_url):
        if USER_PASS_IN_AUTHORITY.search(db_url) or GENERIC_USER_PASS_AT.search(db_url):
            findings.append("database_url contains user:password")
        elif "@" in db_url and "://" in db_url:
            findings.append("database_url is a full connection string")
    if findings:
        extra = " [CRITICAL: post-setup]" if setup_complete is True else ""
        cache["evidence_database"] = build_database_evidence(res)
        return fail_result(
            "database_no_credential_disclosure",
            f"HTTP {res.status} — credential leak{extra}",
            evidence_key="database",
        )
    if isinstance(db_url, str) and len(db_url) > 8 and not looks_redacted(db_url):
        cache["evidence_database"] = build_database_evidence(res)
        return fail_result(
            "database_no_full_url_disclosure",
            f"HTTP {res.status} — non-redacted database_url ({len(db_url)} chars)",
            evidence_key="database",
        )
    if database_response_is_fixed(res.body_json, res.body_text):
        return CaseResult(
            name="database_response_fixed_shape",
            passed=True,
            detail=f"HTTP {res.status} — safe/redacted shape"
            + (f" (driver={driver!r})" if driver else ""),
            severity="pass",
        )
    if res.status == 200 and driver and not db_url:
        return CaseResult(
            name="database_response_minimal",
            passed=True,
            detail=f"driver only: {driver!r}",
            severity="pass",
        )
    return CaseResult(
        name="database_response_safe_or_empty",
        passed=True,
        detail=f"HTTP {res.status} — no credential patterns",
        severity="pass",
    )


def test_storage_endpoint(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_STORAGE)
    res = http_get_with_retries(cfg, url)
    cache["storage"] = res
    _record_timing(cache, "storage", res)
    if res.error:
        return CaseResult(
            name="storage_no_infrastructure_disclosure",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )
    if is_blocked_status(res.status):
        return CaseResult(
            name="storage_endpoint_blocked_or_removed",
            passed=True,
            detail=f"HTTP {res.status} (not publicly readable)",
            severity="pass",
        )
    if res.status >= 500:
        return CaseResult(
            name="storage_no_infrastructure_disclosure",
            passed=False,
            detail=f"HTTP {res.status} — server error",
            severity="error",
        )
    setup_complete = cache.get("setup_complete")
    exposed = storage_exposed_keys(res.body_json)
    if res.status in (200, 201) and exposed:
        extra = " [CRITICAL: post-setup]" if setup_complete is True else ""
        cache["evidence_storage"] = build_storage_evidence(res)
        return fail_result(
            "storage_no_infrastructure_disclosure",
            f"HTTP {res.status} — exposed: {', '.join(exposed)}{extra}",
            evidence_key="storage",
        )
    if storage_response_is_fixed(res.body_json):
        return CaseResult(
            name="storage_response_fixed_shape",
            passed=True,
            detail=f"HTTP {res.status} — safe/redacted storage fields",
            severity="pass",
        )
    return CaseResult(
        name="storage_endpoint_unexpected",
        passed=True,
        detail=f"HTTP {res.status} — no storage metadata leak",
        severity="pass",
    )


def test_post_setup_database_contract(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="post_setup_database_contract",
            passed=True,
            detail="skipped (pre-setup)",
            severity="pass",
        )
    res: HttpResult = cache["database"]
    if is_blocked_status(res.status):
        return CaseResult(
            name="post_setup_database_contract",
            passed=True,
            detail=f"blocked after setup (HTTP {res.status})",
            severity="pass",
        )
    if database_response_is_fixed(res.body_json, res.body_text):
        return CaseResult(
            name="post_setup_database_contract",
            passed=True,
            detail="returns safe/redacted body after setup",
            severity="pass",
        )
    if "evidence_database" not in cache:
        cache["evidence_database"] = build_database_evidence(res)
    return fail_result(
        "post_setup_database_contract",
        "HTTP 200 with secrets/metadata after setup_complete=true",
        evidence_key="database",
    )


def test_post_setup_storage_contract(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="post_setup_storage_contract",
            passed=True,
            detail="skipped (pre-setup)",
            severity="pass",
        )
    res: HttpResult = cache["storage"]
    if is_blocked_status(res.status):
        return CaseResult(
            name="post_setup_storage_contract",
            passed=True,
            detail=f"blocked after setup (HTTP {res.status})",
            severity="pass",
        )
    if storage_response_is_fixed(res.body_json):
        return CaseResult(
            name="post_setup_storage_contract",
            passed=True,
            detail="returns safe/redacted body after setup",
            severity="pass",
        )
    if "evidence_storage" not in cache:
        cache["evidence_storage"] = build_storage_evidence(res)
    return fail_result(
        "post_setup_storage_contract",
        "HTTP 200 with storage metadata after setup_complete=true",
        evidence_key="storage",
    )


def test_setup_database_test_gated(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="setup_database_test_gated",
            passed=True,
            detail="skipped (pre-setup)",
            severity="pass",
        )
    url = api_url(cfg, ROUTE_SETUP_DATABASE_TEST)
    res = http_post_json(
        cfg,
        url,
        {"database_url": "postgres://audit:audit@127.0.0.1:5432/audit"},
    )
    _record_timing(cache, "database_test_post", res)
    if res.status in (401, 403, 404, 409):
        return CaseResult(
            name="setup_database_test_gated",
            passed=True,
            detail=f"POST gated after setup (HTTP {res.status})",
            severity="pass",
        )
    return fail_result(
        "setup_database_test_gated",
        f"POST /setup/database/test still reachable after setup (HTTP {res.status})",
    )


def test_setup_storage_test_gated(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="setup_storage_test_gated",
            passed=True,
            detail="skipped (pre-setup)",
            severity="pass",
        )
    url = api_url(cfg, ROUTE_SETUP_STORAGE_TEST)
    res = http_post_json(cfg, url, {"base_url": "http://127.0.0.1:9000"})
    _record_timing(cache, "storage_test_post", res)
    if res.status in (401, 403, 404, 409):
        return CaseResult(
            name="setup_storage_test_gated",
            passed=True,
            detail=f"POST gated after setup (HTTP {res.status})",
            severity="pass",
        )
    return fail_result(
        "setup_storage_test_gated",
        f"POST /setup/storage/test still reachable after setup (HTTP {res.status})",
    )


def _responses_equivalent(a: HttpResult, b: HttpResult) -> bool:
    return a.status == b.status and a.body_text.strip() == b.body_text.strip()


def test_bogus_auth_database(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_DATABASE)
    plain = http_get_with_retries(cfg, url)
    auth = http_get_with_retries(cfg, url, extra_headers=BOGUS_AUTH)
    if _responses_equivalent(plain, auth):
        return CaseResult(
            name="bogus_auth_ignored_database",
            passed=True,
            detail="bogus Bearer does not change response",
            severity="pass",
        )
    return CaseResult(
        name="bogus_auth_ignored_database",
        passed=False,
        detail=f"response differs with bogus auth (plain={plain.status}, auth={auth.status})",
        severity="error",
    )


def test_bogus_auth_storage(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_STORAGE)
    plain = http_get_with_retries(cfg, url)
    auth = http_get_with_retries(cfg, url, extra_headers=BOGUS_AUTH)
    if _responses_equivalent(plain, auth):
        return CaseResult(
            name="bogus_auth_ignored_storage",
            passed=True,
            detail="bogus Bearer does not change response",
            severity="pass",
        )
    return CaseResult(
        name="bogus_auth_ignored_storage",
        passed=False,
        detail=f"response differs with bogus auth (plain={plain.status}, auth={auth.status})",
        severity="error",
    )


def test_exploit_primitive(_cfg: Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_unauthenticated",
        passed=True,
        detail="probes use no Authorization (unauthenticated attacker)",
        severity="pass",
    )


def test_json_shape(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    problems: list[str] = []
    for route_key, route in (("database", ROUTE_SETUP_DATABASE), ("storage", ROUTE_SETUP_STORAGE)):
        res: HttpResult | None = cache.get(route_key)
        if res is None or res.error or is_blocked_status(res.status):
            continue
        ct = res.headers.get("content-type", "")
        if "text/html" in ct and res.body_json is None:
            problems.append(f"{route} returned HTML not JSON")
    if problems:
        return CaseResult(
            name="responses_are_api_json",
            passed=False,
            detail="; ".join(problems),
            severity="error",
        )
    return CaseResult(
        name="responses_are_api_json",
        passed=True,
        detail="responses are JSON or blocked",
        severity="pass",
    )


def run_sec001_audit(cfg: Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("setup_status", lambda: test_setup_status_probe(cfg, cache)),
        ("database", lambda: test_database_endpoint(cfg, cache)),
        ("storage", lambda: test_storage_endpoint(cfg, cache)),
        ("post_setup_db", lambda: test_post_setup_database_contract(cfg, cache)),
        ("post_setup_st", lambda: test_post_setup_storage_contract(cfg, cache)),
        ("db_test_gated", lambda: test_setup_database_test_gated(cfg, cache)),
        ("st_test_gated", lambda: test_setup_storage_test_gated(cfg, cache)),
        ("bogus_db", lambda: test_bogus_auth_database(cfg, cache)),
        ("bogus_st", lambda: test_bogus_auth_storage(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
        ("json", lambda: test_json_shape(cfg, cache)),
    ]

    for name, fn in steps:
        result = run_case(name, fn)
        results.append(result)
        if result.severity == "error" and name == "target":
            break
        if cfg.fail_fast and not result.passed and result.severity == "fail":
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
    if "evidence_database" in cache:
        evidence["database"] = cache["evidence_database"]
    if "evidence_storage" in cache:
        evidence["storage"] = cache["evidence_storage"]

    hints = []
    if fails:
        hints.append(REMEDIATION_SEC001)
        hints.append(AUDIT_LOG_HINT)

    report = AuditReport(
        audit_id=AUDIT_ID,
        target=f"{cfg.base_url}{cfg.api_prefix}",
        verdict=verdict,
        exit_code=exit_code,
        setup_complete=cache.get("setup_complete"),
        results=results,
        evidence=evidence,
        timings_ms=cache.get("timings_ms", {}),
        remediation_hints=hints,
    )
    return report, cache


def validate_target_url(cfg: Config) -> str | None:
    parsed = urlparse(cfg.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.base_url!r}"
    return None
