#!/usr/bin/env python3
# Human: Standalone SEC-001 verification — public setup endpoints must not leak secrets.
# Agent: HTTP GET only; READS env SEC001_*; no app imports; exit 0 when fixed, 1 when vulnerable or misconfigured.

"""
SEC-001 — Public setup endpoints leak database credentials and infrastructure metadata

security-audit.md finding:
  GET /api/v1/setup/database  — may return full database_url with credentials
  GET /api/v1/setup/storage — may return object-storage URLs, bucket, mode

This suite is repository-agnostic: point it at any running API base URL.

Environment:
  SEC001_BASE_URL          Base URL (default: http://127.0.0.1:8080)
  SEC001_API_PREFIX        API prefix (default: /api/v1)
  SEC001_TIMEOUT_SEC       Per-request timeout seconds (default: 15)
  SEC001_INSECURE_TLS      If "1", skip TLS certificate verification
  SEC001_REQUIRE_SETUP     If "1", fail if setup_complete is false (post-setup checks only)
  SEC001_VERBOSE           If "1", also print full raw response bodies on errors
  SEC001_SHOW_LEAKS        If "0", omit exploit evidence block (default: show leaks)
  SEC001_NO_COLOR          If "1", disable ANSI colors (also respects NO_COLOR)
  SEC001_NO_REDACTION      If "1", same as CLI --no-redaction (show full secrets in output)

CLI:
  --no-redaction           Disable output redaction (default: sensitive values are masked)

Exit codes:
  0 — All checks passed (endpoints blocked or responses appear safe)
  1 — Vulnerability indicators detected or required checks could not run
  2 — Configuration / connectivity error (target unreachable, invalid URL)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urljoin, urlparse

# Human: Audit ID and routes under test (override prefix via SEC001_API_PREFIX).
# Agent: CONSTANTS only; paths joined with prefix at runtime.
AUDIT_ID = "SEC-001"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"
ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_SETUP_DATABASE = "/setup/database"
ROUTE_SETUP_STORAGE = "/setup/storage"

# Human: Heuristics for “this JSON still contains a live connection string or password material”.
# Agent: REGEX list; false positives possible on hostnames — tune SEC001_VERBOSE to inspect bodies.
CREDENTIAL_URL_SCHEMES = re.compile(
    r"(?i)(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp)://[^\s\"']+",
)
USER_PASS_IN_AUTHORITY = re.compile(
    r"(?i)(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis)://[^:]+:[^@/]+@",
)
GENERIC_USER_PASS_AT = re.compile(r"://[^/\s\"']+:[^@\s\"']+@[^\s\"']+")
PASSWORD_QUERY_PARAM = re.compile(r"(?i)[?&]password=[^&\s\"']+")
SECRET_JSON_KEYS = re.compile(
    r"(?i)\"(?:password|passwd|secret|api[_-]?key|access[_-]?key|secret[_-]?key)\"\s*:\s*\"[^\"]{3,}\"",
)
REDACTION_MARKERS = re.compile(
    r"(?i)(\[redacted\]|\*\*\*|••••|<redacted>|__REDACTED__|REDACTED)",
)


@dataclass
class Config:
    base_url: str
    api_prefix: str
    timeout_sec: float
    insecure_tls: bool
    require_setup_complete: bool
    verbose: bool
    show_leaks: bool
    # Human: When True, exploit evidence masks passwords in URLs before printing.
    # Agent: default True; --no-redaction / SEC001_NO_REDACTION disables masking.
    redact_output: bool


@dataclass
class HttpResult:
    status: int
    headers: dict[str, str]
    body_text: str
    body_json: Any | None
    error: str | None = None


@dataclass
class CaseResult:
    name: str
    passed: bool
    detail: str
    severity: str  # "fail" = vuln or required check failed; "error" = could not run; "pass"
    # Human: Short label for grouped exploit evidence (database | storage).
    # Agent: set on FAIL; Reporter prints full payload once per group at end.
    evidence_key: str | None = None


@dataclass
class LeakEvidence:
    """Human: One endpoint’s unauthenticated JSON fields worth showing the operator."""

    title: str
    route: str
    status: int
    fields: dict[str, str]


# Human: Friendly titles for checklist lines (internal test name → display).
# Agent: READ by Reporter only.
CASE_LABELS: dict[str, str] = {
    "target_reachable": "API reachable",
    "setup_status_readable": "Setup status readable",
    "setup_status_post_setup": "Instance reports setup complete",
    "database_no_credential_disclosure": "Database credentials not exposed",
    "database_no_full_url_disclosure": "No full database_url in response",
    "database_endpoint_blocked_or_removed": "Database endpoint blocked when public",
    "database_response_minimal": "Database response minimal",
    "database_response_safe_or_empty": "Database response safe",
    "database_endpoint_unexpected_status": "Database endpoint status acceptable",
    "storage_no_infrastructure_disclosure": "Storage metadata not exposed",
    "storage_endpoint_blocked_or_removed": "Storage endpoint blocked when public",
    "storage_response_minimal": "Storage response minimal",
    "storage_endpoint_unexpected": "Storage endpoint acceptable",
    "post_setup_database_hardened": "After setup: database endpoint hardened",
    "post_setup_storage_hardened": "After setup: storage endpoint hardened",
    "exploit_primitive_unauthenticated": "Attack uses no Authorization header",
    "responses_are_api_json": "Responses are API JSON (not HTML)",
}


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    # Human: Minimal CLI — primary flag is --no-redaction for full secret display.
    # Agent: RETURNS Namespace; other settings still come from SEC001_* env vars.
    parser = argparse.ArgumentParser(
        prog="sec001_setup_info_disclosure.py",
        description=(
            "SEC-001 audit: detect unauthenticated disclosure via "
            "GET /setup/database and GET /setup/storage."
        ),
    )
    parser.add_argument(
        "--no-redaction",
        action="store_true",
        help="print raw leaked values (default: redact passwords and secrets in all output)",
    )
    return parser.parse_args(argv)


def load_config(cli: argparse.Namespace | None = None) -> Config:
    if cli is None:
        cli = parse_cli()
    base = os.environ.get("SEC001_BASE_URL", DEFAULT_BASE_URL).strip().rstrip("/")
    prefix = os.environ.get("SEC001_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC001_TIMEOUT_SEC", "15"))
    no_redaction = cli.no_redaction or _env_bool("SEC001_NO_REDACTION")
    return Config(
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC001_INSECURE_TLS"),
        require_setup_complete=_env_bool("SEC001_REQUIRE_SETUP"),
        verbose=_env_bool("SEC001_VERBOSE"),
        show_leaks=_env_show_leaks(),
        redact_output=not no_redaction,
    )


def _env_show_leaks() -> bool:
    # Human: Leaked values print on every FAIL unless operator opts out (CI log hygiene).
    # Agent: SEC001_SHOW_LEAKS=0|false|no|off hides leak blocks; default is show.
    raw = os.environ.get("SEC001_SHOW_LEAKS", "").strip().lower()
    if not raw:
        return True
    return raw not in ("0", "false", "no", "off")


def api_url(cfg: Config, route: str) -> str:
    path = f"{cfg.api_prefix}{route}"
    return urljoin(cfg.base_url + "/", path.lstrip("/"))


def http_get(cfg: Config, url: str) -> HttpResult:
    ctx = None
    if cfg.insecure_tls and url.lower().startswith("https"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": f"ownly-sec001-audit/{AUDIT_ID}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_sec, context=ctx) as resp:
            raw = resp.read()
            text = raw.decode("utf-8", errors="replace")
            headers = {k.lower(): v for k, v in resp.headers.items()}
            parsed: Any | None
            try:
                parsed = json.loads(text) if text.strip() else None
            except json.JSONDecodeError:
                parsed = None
            return HttpResult(status=resp.status, headers=headers, body_text=text, body_json=parsed)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        text = raw.decode("utf-8", errors="replace")
        headers = {k.lower(): v for k, v in exc.headers.items()}
        parsed: Any | None
        try:
            parsed = json.loads(text) if text.strip() else None
        except json.JSONDecodeError:
            parsed = None
        return HttpResult(status=exc.code, headers=headers, body_text=text, body_json=parsed)
    except urllib.error.URLError as exc:
        return HttpResult(
            status=0,
            headers={},
            body_text="",
            body_json=None,
            error=str(exc.reason),
        )
    except TimeoutError:
        return HttpResult(
            status=0,
            headers={},
            body_text="",
            body_json=None,
            error=f"timeout after {cfg.timeout_sec}s",
        )


def is_blocked_status(status: int) -> bool:
    return status in (401, 403, 404, 405, 410, 451)


def body_contains_credential_material(text: str) -> list[str]:
    findings: list[str] = []
    if not text:
        return findings
    checks: list[tuple[str, re.Pattern[str]]] = [
        ("connection URL with scheme", CREDENTIAL_URL_SCHEMES),
        ("user:password in URL authority", USER_PASS_IN_AUTHORITY),
        ("generic user:pass@ host pattern", GENERIC_USER_PASS_AT),
        ("password query parameter", PASSWORD_QUERY_PARAM),
        ("sensitive JSON key with value", SECRET_JSON_KEYS),
    ]
    for label, pattern in checks:
        if pattern.search(text):
            findings.append(label)
    return findings


def looks_redacted(value: str) -> bool:
    if not value or not value.strip():
        return True
    if REDACTION_MARKERS.search(value):
        return True
    # Human: Placeholder URLs without embedded credentials are acceptable.
    # Agent: no @ after scheme often means no userinfo — still flag if user:pass@ matched elsewhere.
    if value.strip() in ("", "null", "none", "N/A", "n/a"):
        return True
    return False


def json_get(obj: Any, key: str) -> Any | None:
    if isinstance(obj, dict):
        return obj.get(key)
    return None


def _format_leak_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


# Human: Match userinfo in URLs anywhere in a string (JSON bodies, connection strings, etc.).
# Agent: used by redact_sensitive_text; global scan not anchored to line start.
URL_AUTHORITY_USERINFO = re.compile(
    r"([a-z][a-z0-9+.-]*://)([^/\s\"'@]+)@",
    re.IGNORECASE,
)

# Human: Query parameters that often carry secrets on storage or DB URLs.
# Agent: masked to param=*** when redact_output is True (default).
SENSITIVE_QUERY_PARAMS = re.compile(
    r"([?&](?:password|passwd|secret|access_key|secret_key|api_key|token)=)[^&\s\"']+",
    re.IGNORECASE,
)

# Human: Replace JSON string values for known secret keys in printed bodies.
# Agent: display-only; detection heuristics use separate patterns.
SECRET_JSON_KV = re.compile(
    r'("(?:password|passwd|secret|api[_-]?key|access[_-]?key|secret[_-]?key|token)")\s*:\s*"([^"]*)"',
    re.IGNORECASE,
)


def _redact_url_authority(match: re.Match[str]) -> str:
    prefix = match.group(1)
    userinfo = match.group(2)
    if ":" in userinfo:
        user = userinfo.split(":", 1)[0]
        return f"{prefix}{user}:***@"
    if userinfo in ("***", ""):
        return match.group(0)
    return f"{prefix}***@"


def redact_sensitive_text(text: str) -> str:
    # Human: Default stdout sanitization — masks credentials embedded anywhere in printed text.
    # Agent: CALLS regex subs; no-op when caller passes through --no-redaction; not used for vuln checks.
    if not text:
        return text
    out = URL_AUTHORITY_USERINFO.sub(_redact_url_authority, text)
    out = SENSITIVE_QUERY_PARAMS.sub(r"\1***", out)
    out = PASSWORD_QUERY_PARAM.sub("password=***", out)
    out = SECRET_JSON_KV.sub(r'\1: "***"', out)
    return out


def redact_field_for_display(field_key: str, value: str) -> str:
    # Human: Per-field wrapper — every exploit evidence value runs through redact_sensitive_text by default.
    # Agent: field_key reserved for future per-key rules; currently all values get the same scan.
    _ = field_key
    return redact_sensitive_text(value)


def evidence_from_json(
    title: str,
    route: str,
    res: HttpResult,
    field_order: tuple[str, ...],
) -> LeakEvidence:
    fields: dict[str, str] = {}
    if res.body_json is not None and isinstance(res.body_json, dict):
        for key in field_order:
            if key in res.body_json:
                fields[key] = _format_leak_value(res.body_json[key])
        for key in sorted(res.body_json):
            if key not in fields:
                fields[key] = _format_leak_value(res.body_json[key])
    elif res.body_text.strip():
        fields["raw_body"] = res.body_text.strip()
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)


def build_database_evidence(res: HttpResult) -> LeakEvidence:
    return evidence_from_json(
        "Database connection (setup wizard leak)",
        ROUTE_SETUP_DATABASE,
        res,
        ("driver", "database_url"),
    )


def build_storage_evidence(res: HttpResult) -> LeakEvidence:
    return evidence_from_json(
        "Object storage configuration",
        ROUTE_SETUP_STORAGE,
        res,
        (
            "object_storage_url",
            "object_storage_public_url",
            "object_storage_bucket",
            "storage_mode",
        ),
    )


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
    )


def run_case(name: str, fn: Callable[[], CaseResult]) -> CaseResult:
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — audit script must report all failures
        return CaseResult(
            name=name,
            passed=False,
            detail=f"unexpected error: {exc}",
            severity="error",
        )


# --- Individual tests ---


def test_target_reachable(cfg: Config) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_STATUS)
    res = http_get(cfg, url)

    if res.error:
        return CaseResult(
            name="target_reachable",
            passed=False,
            detail=f"cannot reach {url}: {res.error}",
            severity="error",
        )
    if res.status == 0:
        return CaseResult(
            name="target_reachable",
            passed=False,
            detail=f"no HTTP status from {url}",
            severity="error",
        )
    return CaseResult(
        name="target_reachable",
        passed=True,
        detail=f"GET {ROUTE_SETUP_STATUS} -> HTTP {res.status}",
        severity="pass",
    )


def test_setup_status_probe(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_STATUS)
    res = http_get(cfg, url)
    cache["setup_status"] = res

    if res.error:
        return CaseResult(
            name="setup_status_readable",
            passed=False,
            detail=f"setup status unavailable: {res.error}",
            severity="error",
        )
    if res.status >= 500:
        return CaseResult(
            name="setup_status_readable",
            passed=False,
            detail=f"server error HTTP {res.status} on setup/status",
            severity="error",
        )
    complete = None
    if res.body_json is not None:
        complete = json_get(res.body_json, "setup_complete")
    cache["setup_complete"] = complete
    detail = f"HTTP {res.status}, setup_complete={complete!r}"
    if cfg.require_setup_complete and complete is not True:
        return CaseResult(
            name="setup_status_post_setup",
            passed=False,
            detail=(
                f"{detail} — SEC001_REQUIRE_SETUP=1 but instance does not report "
                "setup_complete=true (cannot verify post-setup hardening)"
            ),
            severity="error",
        )
    return CaseResult(
        name="setup_status_readable",
        passed=True,
        detail=detail,
        severity="pass",
    )


def test_database_endpoint_unauthenticated(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_DATABASE)
    res = http_get(cfg, url)
    cache["database"] = res

    if res.error:
        return CaseResult(
            name="database_endpoint_no_auth",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )

    setup_complete = cache.get("setup_complete")
    if is_blocked_status(res.status):
        return CaseResult(
            name="database_endpoint_blocked_or_removed",
            passed=True,
            detail=f"GET {ROUTE_SETUP_DATABASE} -> HTTP {res.status} (not publicly readable)",
            severity="pass",
        )

    if res.status >= 500:
        return CaseResult(
            name="database_endpoint_no_auth",
            passed=False,
            detail=f"HTTP {res.status} — inconclusive server error",
            severity="error",
        )

    # HTTP 2xx — inspect body (core SEC-001 exploit check)
    findings = body_contains_credential_material(res.body_text)
    db_url = None
    driver = None
    if res.body_json is not None:
        db_url = json_get(res.body_json, "database_url")
        driver = json_get(res.body_json, "driver")

    if isinstance(db_url, str) and db_url.strip() and not looks_redacted(db_url):
        if USER_PASS_IN_AUTHORITY.search(db_url) or GENERIC_USER_PASS_AT.search(db_url):
            findings.append("database_url field contains user:password authority")
        elif "@" in db_url and "://" in db_url and not looks_redacted(db_url):
            findings.append("database_url appears to be a full connection string")

    if findings:
        extra = ""
        if setup_complete is True:
            extra = " [CRITICAL: setup_complete=true but secrets still exposed]"
        cache["evidence_database"] = build_database_evidence(res)
        return fail_result(
            "database_no_credential_disclosure",
            f"HTTP {res.status} — credentials in response{extra}",
            evidence_key="database",
        )

    if isinstance(db_url, str) and len(db_url) > 8 and not looks_redacted(db_url):
        cache["evidence_database"] = build_database_evidence(res)
        return fail_result(
            "database_no_full_url_disclosure",
            f"HTTP {res.status} — full database_url returned ({len(db_url)} chars)",
            evidence_key="database",
        )

    if res.status == 200 and driver and not db_url:
        return CaseResult(
            name="database_response_minimal",
            passed=True,
            detail=f"HTTP 200 with driver only (no database_url): driver={driver!r}",
            severity="pass",
        )

    if res.status == 200:
        return CaseResult(
            name="database_response_safe_or_empty",
            passed=True,
            detail="HTTP 200 but no credential patterns detected in body",
            severity="pass",
        )

    return CaseResult(
        name="database_endpoint_unexpected_status",
        passed=True,
        detail=f"HTTP {res.status} without credential patterns (review manually if unexpected)",
        severity="pass",
    )


def test_storage_endpoint_unauthenticated(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    url = api_url(cfg, ROUTE_SETUP_STORAGE)
    res = http_get(cfg, url)
    cache["storage"] = res

    if res.error:
        return CaseResult(
            name="storage_endpoint_no_auth",
            passed=False,
            detail=f"request failed: {res.error}",
            severity="error",
        )

    if is_blocked_status(res.status):
        return CaseResult(
            name="storage_endpoint_blocked_or_removed",
            passed=True,
            detail=f"GET {ROUTE_SETUP_STORAGE} -> HTTP {res.status} (not publicly readable)",
            severity="pass",
        )

    if res.status >= 500:
        return CaseResult(
            name="storage_endpoint_no_auth",
            passed=False,
            detail=f"HTTP {res.status} — inconclusive server error",
            severity="error",
        )

    setup_complete = cache.get("setup_complete")
    sensitive_keys = (
        "object_storage_url",
        "object_storage_public_url",
        "object_storage_bucket",
        "storage_mode",
    )
    exposed_keys: list[str] = []
    if res.body_json is not None:
        for key in sensitive_keys:
            val = json_get(res.body_json, key)
            if isinstance(val, str) and val.strip() and not looks_redacted(val):
                exposed_keys.append(key)

    if res.status in (200, 201) and exposed_keys:
        extra = ""
        if setup_complete is True:
            extra = " [CRITICAL: setup_complete=true but storage metadata still public]"
        cache["evidence_storage"] = build_storage_evidence(res)
        return fail_result(
            "storage_no_infrastructure_disclosure",
            f"HTTP {res.status} — infrastructure fields public ({', '.join(exposed_keys)}){extra}",
            evidence_key="storage",
        )

    if res.status in (200, 201) and res.body_json:
        return CaseResult(
            name="storage_response_minimal",
            passed=True,
            detail=f"HTTP {res.status} without sensitive storage fields in JSON",
            severity="pass",
        )

    return CaseResult(
        name="storage_endpoint_unexpected",
        passed=True,
        detail=f"HTTP {res.status} — no storage metadata disclosure detected",
        severity="pass",
    )


def test_post_setup_database_must_not_leak(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="post_setup_database_hardened",
            passed=True,
            detail="skipped (setup_complete is not true)",
            severity="pass",
        )
    res: HttpResult | None = cache.get("database")
    if res is None:
        return CaseResult(
            name="post_setup_database_hardened",
            passed=False,
            detail="missing cached database response",
            severity="error",
        )
    if is_blocked_status(res.status):
        return CaseResult(
            name="post_setup_database_hardened",
            passed=True,
            detail=f"after setup: database endpoint returns HTTP {res.status}",
            severity="pass",
        )
    findings = body_contains_credential_material(res.body_text)
    db_url = json_get(res.body_json, "database_url") if res.body_json else None
    if isinstance(db_url, str) and db_url.strip() and not looks_redacted(db_url):
        findings.append("database_url present after setup")
    if findings:
        if "evidence_database" not in cache:
            cache["evidence_database"] = build_database_evidence(res)
        return fail_result(
            "post_setup_database_hardened",
            "Still returns secrets while setup_complete=true",
            evidence_key="database",
        )
    return CaseResult(
        name="post_setup_database_hardened",
        passed=True,
        detail="no credential material on database endpoint after setup_complete=true",
        severity="pass",
    )


def test_post_setup_storage_must_not_leak(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="post_setup_storage_hardened",
            passed=True,
            detail="skipped (setup_complete is not true)",
            severity="pass",
        )
    res: HttpResult | None = cache.get("storage")
    if res is None:
        return CaseResult(
            name="post_setup_storage_hardened",
            passed=False,
            detail="missing cached storage response",
            severity="error",
        )
    if is_blocked_status(res.status):
        return CaseResult(
            name="post_setup_storage_hardened",
            passed=True,
            detail=f"after setup: storage endpoint returns HTTP {res.status}",
            severity="pass",
        )
    if res.status in (200, 201) and res.body_json:
        for key in (
            "object_storage_url",
            "object_storage_public_url",
            "object_storage_bucket",
        ):
            val = json_get(res.body_json, key)
            if isinstance(val, str) and val.strip() and not looks_redacted(val):
                if "evidence_storage" not in cache:
                    cache["evidence_storage"] = build_storage_evidence(res)
                return fail_result(
                    "post_setup_storage_hardened",
                    f"Still exposes {key} while setup_complete=true",
                    evidence_key="storage",
                )
    return CaseResult(
        name="post_setup_storage_hardened",
        passed=True,
        detail="storage endpoint safe or non-revealing after setup_complete=true",
        severity="pass",
    )


def test_exploit_primitive_no_auth_header(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    # Human: SEC-001 attack model is fully unauthenticated — this case documents the probe method.
    # Agent: always PASS; credential/metadata cases above carry the actual pass/fail signal.
    return CaseResult(
        name="exploit_primitive_unauthenticated",
        passed=True,
        detail="all probes sent without Authorization header (unauthenticated attacker model)",
        severity="pass",
    )


def test_json_not_html_error_page(cfg: Config, cache: dict[str, Any]) -> CaseResult:
    problems: list[str] = []
    for route_key, route in (("database", ROUTE_SETUP_DATABASE), ("storage", ROUTE_SETUP_STORAGE)):
        res: HttpResult | None = cache.get(route_key)
        if res is None or res.error or is_blocked_status(res.status):
            continue
        ct = res.headers.get("content-type", "")
        if "text/html" in ct and res.body_json is None:
            problems.append(f"{route} returned HTML (likely reverse proxy), not API JSON")
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
        detail="blocked or JSON responses look like API (not HTML error pages)",
        severity="pass",
    )


class AuditReporter:
    # Human: Terminal presentation for SEC-001 — colors optional, evidence once at end.
    # Agent: WRITES stdout; respects NO_COLOR; groups checklist + exploit evidence.

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.use_color = self._color_enabled()
        self.width = 72

    def _color_enabled(self) -> bool:
        if os.environ.get("NO_COLOR", "").strip():
            return False
        if os.environ.get("SEC001_NO_COLOR", "").strip().lower() in ("1", "true", "yes"):
            return False
        return sys.stdout.isatty()

    def _c(self, code: str, text: str) -> str:
        if not self.use_color:
            return text
        return f"\033[{code}m{text}\033[0m"

    def green(self, text: str) -> str:
        return self._c("32", text)

    def red(self, text: str) -> str:
        return self._c("31", text)

    def yellow(self, text: str) -> str:
        return self._c("33", text)

    def dim(self, text: str) -> str:
        return self._c("2", text)

    def bold(self, text: str) -> str:
        return self._c("1", text)

    def _line(self, char: str = "─") -> str:
        return char * self.width

    def _heading(self, title: str) -> None:
        print()
        print(self.bold(f"  {title}"))
        print(self.dim(f"  {self._line()}"))

    def banner(self) -> None:
        title = f"{AUDIT_ID}  Setup endpoint disclosure audit"
        inner = self.width - 2
        pad = max(0, inner - len(title) - 2)
        print()
        print(self.bold(f"╭{'─' * inner}╮"))
        print(self.bold(f"│ {title}{' ' * pad} │"))
        print(self.bold(f"╰{'─' * inner}╯"))
        print()
        print(f"  {'Target':<12} {self.cfg.base_url}{self.cfg.api_prefix}")
        print(f"  {'Attack':<12} {self.dim('unauthenticated GET (no Authorization header)')}")
        print(
            f"  {'Probes':<12} GET {ROUTE_SETUP_DATABASE}  ·  GET {ROUTE_SETUP_STORAGE}"
        )
        print(
            f"  {'Timeout':<12} {self.cfg.timeout_sec}s"
            f"  ·  TLS verify: {'off' if self.cfg.insecure_tls else 'on'}"
        )
        if self.cfg.redact_output:
            print(
                f"  {'Output':<12} "
                f"{self.dim('sensitive values redacted (pass --no-redaction to show raw leaks)')}"
            )
        else:
            print(
                f"  {'Output':<12} "
                f"{self.yellow('no redaction — raw secrets printed (--no-redaction)')}"
            )

    def format_for_display(self, field_key: str, value: str) -> str:
        # Human: Single gate for stdout — default path redacts; --no-redaction returns verbatim API values.
        # Agent: READS cfg.redact_output; CALLS redact_field_for_display when True.
        if not self.cfg.redact_output:
            return value
        return redact_field_for_display(field_key, value)

    def status_icon(self, result: CaseResult) -> str:
        if result.passed:
            return self.green("✓")
        if result.severity == "error":
            return self.yellow("!")
        return self.red("✗")

    def checklist_line(self, result: CaseResult) -> None:
        label = CASE_LABELS.get(result.name, result.name.replace("_", " "))
        icon = self.status_icon(result)
        line = f"  {icon}  {label}"
        if not result.passed:
            detail = self.format_for_display("detail", result.detail)
            line += self.dim(f"  —  {detail}")
        print(line)

    def checklist_subline(self, result: CaseResult) -> None:
        label = CASE_LABELS.get(result.name, result.name.replace("_", " "))
        detail = self.format_for_display("detail", result.detail)
        print(f"       {self.dim('↳')}  {label}  —  {self.dim(detail)}")

    def print_checks(self, results: list[CaseResult]) -> None:
        # Human: Indent post-setup failures when the same endpoint already failed above.
        # Agent: READS evidence_key order; avoids repeating the same headline twice.
        seen_fail_keys: set[str] = set()
        for result in results:
            if (
                not result.passed
                and result.evidence_key
                and result.name.startswith("post_setup_")
                and result.evidence_key in seen_fail_keys
            ):
                self.checklist_subline(result)
                continue
            if not result.passed and result.evidence_key:
                seen_fail_keys.add(result.evidence_key)
            self.checklist_line(result)

    def context_block(self, cache: dict[str, Any]) -> None:
        self._heading("Instance")
        complete = cache.get("setup_complete")
        if complete is True:
            print(f"  {self.dim('setup_complete')}     {self.yellow('true')}  {self.dim('(post-setup hardening applies)')}")
        elif complete is False:
            print(f"  {self.dim('setup_complete')}     {self.green('false')}  {self.dim('(pre-setup)')}")
        else:
            print(f"  {self.dim('setup_complete')}     {self.dim('unknown')}")

    def evidence_block(self, cache: dict[str, Any]) -> None:
        if not self.cfg.show_leaks:
            return
        db: LeakEvidence | None = cache.get("evidence_database")
        st: LeakEvidence | None = cache.get("evidence_storage")
        if not db and not st:
            return

        self._heading("Exploit evidence  (unauthenticated response bodies)")
        if self.cfg.redact_output:
            print(self.dim("  Passwords and secrets are redacted below. Use --no-redaction to see raw values."))
        else:
            print(self.yellow("  ⚠  Raw secrets shown — handle output as confidential."))
        print()

        for ev in (db, st):
            if ev is None:
                continue
            self._print_endpoint_evidence(ev)

    def _print_endpoint_evidence(self, ev: LeakEvidence) -> None:
        route_display = f"{self.cfg.api_prefix}{ev.route}"
        print(self.bold(f"  ▶  GET {route_display}"))
        print(
            self.dim(
                f"     {ev.title}  ·  HTTP {ev.status}",
            ),
        )
        if not ev.fields:
            print(self.dim("     (empty JSON body)"))
            print()
            return
        key_width = max(len(k) for k in ev.fields)
        for key, value in ev.fields.items():
            display = self.format_for_display(key, value)
            dots = "." * max(1, 24 - key_width)
            print(f"     {self.dim(f'{key:<{key_width}}')} {dots}  {display}")
        print()

    def summary(
        self,
        results: list[CaseResult],
        cache: dict[str, Any],
    ) -> None:
        fails = [r for r in results if not r.passed and r.severity == "fail"]
        errors = [r for r in results if not r.passed and r.severity == "error"]
        passes = [r for r in results if r.passed]

        self._heading("Summary")
        print(f"  {self.green('Passed'):<10} {len(passes)}")
        print(f"  {self.red('Failed'):<10} {len(fails)}  {self.dim('(vulnerability indicators)')}")
        print(f"  {self.yellow('Errors'):<10} {len(errors)}  {self.dim('(connectivity / inconclusive)')}")

        if fails and self.cfg.show_leaks:
            self.evidence_block(cache)

        self._heading("Verdict")
        if fails:
            print(f"  {self.red('✗  VULNERABLE')}")
            print(self.dim("     Public setup endpoints disclose secrets or infrastructure metadata."))
            print(self.dim("     See security-audit.md → SEC-001 for remediation steps."))
            return
        if errors:
            print(f"  {self.yellow('?  INCONCLUSIVE')}")
            print(self.dim("     Fix connectivity or set SEC001_VERBOSE=1, then re-run."))
            return
        print(f"  {self.green('✓  OK')}")
        print(self.dim("     No SEC-001 disclosure indicators detected for this target."))

    def verbose_error_bodies(self, cache: dict[str, Any]) -> None:
        if not self.cfg.verbose:
            return
        for key, label in (
            ("database", ROUTE_SETUP_DATABASE),
            ("storage", ROUTE_SETUP_STORAGE),
            ("setup_status", ROUTE_SETUP_STATUS),
        ):
            res: HttpResult | None = cache.get(key)
            if res and res.body_text:
                self._heading(f"Debug raw body — {label}")
                body = self.format_for_display("raw_body", res.body_text[:2000])
                print(self.dim(body))


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    cfg = load_config(cli)
    parsed = urlparse(cfg.base_url)
    if not parsed.scheme or not parsed.netloc:
        print(f"Invalid SEC001_BASE_URL: {cfg.base_url!r}", file=sys.stderr)
        return 2

    report = AuditReporter(cfg)
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    report.banner()

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("target_reachable", lambda: test_target_reachable(cfg)),
        ("setup_status", lambda: test_setup_status_probe(cfg, cache)),
    ]

    for name, fn in steps:
        result = run_case(name, fn)
        results.append(result)
        if result.severity == "error" and name == "target_reachable":
            report._heading("Checks")
            report.checklist_line(result)
            print()
            sys.stderr.write(report.red("  Aborting: target unreachable.\n"))
            return 2

    dependent: list[tuple[str, Callable[[], CaseResult]]] = [
        ("database", lambda: test_database_endpoint_unauthenticated(cfg, cache)),
        ("storage", lambda: test_storage_endpoint_unauthenticated(cfg, cache)),
        ("post_setup_database", lambda: test_post_setup_database_must_not_leak(cfg, cache)),
        ("post_setup_storage", lambda: test_post_setup_storage_must_not_leak(cfg, cache)),
        ("exploit_primitive", lambda: test_exploit_primitive_no_auth_header(cfg, cache)),
        ("json_shape", lambda: test_json_not_html_error_page(cfg, cache)),
    ]

    for name, fn in dependent:
        results.append(run_case(name, fn))

    report.context_block(cache)
    report._heading("Checks")
    report.print_checks(results)

    report.verbose_error_bodies(cache)
    report.summary(results, cache)
    print()

    fails = [r for r in results if not r.passed and r.severity == "fail"]
    errors = [r for r in results if not r.passed and r.severity == "error"]
    if fails:
        return 1
    if errors:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
