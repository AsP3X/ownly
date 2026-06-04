# Human: CLI and environment configuration for SEC-012 exploit script.
# Agent: READS SEC012_* and JWT_SECRET from .env; interactive wizard on TTY; RETURNS Sec012Config.

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from .config import _env_bool, require_interactive_prompt
from .constants_sec012 import (
    AUDIT_ID,
    CREATED_ADMIN_EMAIL_FALLBACK_DOMAIN,
    CREATED_ADMIN_EMAIL_FALLBACK_PREFIX,
    DEFAULT_ADMIN_PROBE_ROUTE,
    DEFAULT_API_PREFIX,
    DEFAULT_BASE_URL,
)
from .env_file import load_sec012_env_file
from .heuristics_sec012 import normalize_created_admin_email
from .jwt_sec012 import resolve_jwt_secret_candidates
from .models import Config, Sec012Config

_LOADED_ENV_FILE: Path | None = None


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec012_unauthenticated_admin_creation.py",
        description=(
            "SEC-012: live exploit — setup hijack (fresh DB) or JWT forgery + admin user "
            "creation on initialized instances."
        ),
    )
    parser.add_argument("--env-file", metavar="PATH", help="load SEC012_* and JWT_SECRET from .env")
    parser.add_argument("--base-url", metavar="URL", help="API origin (prompted on TTY when omitted)")
    parser.add_argument(
        "--confirm-exploit",
        action="store_true",
        help="skip interactive exploit confirmation (still prompts other fields on TTY)",
    )
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="force interactive prompts for target URL and credentials (requires TTY)",
    )
    parser.add_argument(
        "--no-prompt",
        action="store_true",
        help="never prompt; require target URL, confirmation, and credentials via flags/env",
    )
    parser.add_argument(
        "--exploit-email",
        metavar="EMAIL",
        help="subject account email (login/register) or setup hijack email",
    )
    parser.add_argument(
        "--exploit-password",
        metavar="PASSWORD",
        help="subject account password (min 8 chars)",
    )
    parser.add_argument(
        "--created-admin-email",
        metavar="EMAIL",
        help=(
            "name or email for the new administrator inserted via POST /admin/users "
            "(username-only values get @audit.invalid; default: sec012-created-<random>@audit.invalid)"
        ),
    )
    parser.add_argument(
        "--instance-name",
        metavar="NAME",
        default=None,
        help="instance_name for POST /setup on fresh DB only",
    )
    parser.add_argument(
        "--jwt-secret",
        metavar="SECRET",
        help="JWT_SECRET to try first (also reads JWT_SECRET from .env)",
    )
    parser.add_argument(
        "--no-try-dev-defaults",
        action="store_true",
        help="do not try Compose/dev JWT defaults",
    )
    parser.add_argument(
        "--skip-jwt-forgery",
        action="store_true",
        help="only run setup hijack (fresh DB); skip initialized-instance chain",
    )
    parser.add_argument(
        "--no-bootstrap-via-admin",
        action="store_true",
        help="do not create a temporary pro user when SEC012 credentials are already admin",
    )
    parser.add_argument(
        "--admin-probe-route",
        metavar="PATH",
        default=None,
        help=f"admin route to verify access (default: {DEFAULT_ADMIN_PROBE_ROUTE})",
    )
    parser.add_argument("--no-redaction", action="store_true", help="print raw tokens in output")
    parser.add_argument("--json", action="store_const", const="json", dest="output_format")
    parser.add_argument("--sarif", action="store_const", const="sarif", dest="output_format")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--retries", type=int, default=None, metavar="N")
    parser.add_argument("--fail-fast", action="store_true")
    parser.add_argument("--output-file", metavar="PATH")
    parser.add_argument("--save-baseline", metavar="PATH")
    parser.add_argument("--compare-baseline", metavar="PATH")
    return parser.parse_args(argv)


def loaded_env_file_path() -> Path | None:
    return _LOADED_ENV_FILE


def _env_show_leaks() -> bool:
    raw = os.environ.get("SEC012_SHOW_LEAKS", "").strip().lower()
    if not raw:
        return True
    return raw not in ("0", "false", "no", "off")


def _prompt_yes_no(prompt: str, *, default_no: bool = True) -> bool:
    suffix = " [y/N]: " if default_no else " [Y/n]: "
    answer = input(f"{prompt}{suffix}").strip().lower()
    if not answer:
        return not default_no
    return answer in ("y", "yes")


def _validate_base_url(url: str) -> str | None:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return f"Invalid base URL: {url!r}"
    return None


def _missing_non_interactive_fields(
    *,
    cli: argparse.Namespace,
    base_url: str,
    confirm_exploit: bool,
    exploit_email: str,
    exploit_password: str,
    jwt_secrets: tuple[str, ...],
) -> list[str]:
    # Human: Fields required when --no-prompt / non-TTY automation is used.
    # Agent: RETURNS human labels for error messages.
    missing: list[str] = []
    if not cli.base_url and not os.environ.get("SEC012_BASE_URL", "").strip():
        missing.append("target URL (--base-url or SEC012_BASE_URL)")
    if _validate_base_url(base_url):
        missing.append("valid target URL")
    if not confirm_exploit:
        missing.append("exploit confirmation (--confirm-exploit or SEC012_CONFIRM_EXPLOIT=1)")
    if not exploit_email:
        missing.append("subject email (--exploit-email or SEC012_EXPLOIT_EMAIL)")
    if not exploit_password:
        missing.append("subject password (--exploit-password or SEC012_EXPLOIT_PASSWORD)")
    if not jwt_secrets and not (cli.jwt_secret or os.environ.get("SEC012_JWT_SECRET", "").strip()):
        missing.append("JWT_SECRET (--jwt-secret, JWT_SECRET in .env, or dev defaults)")
    return missing


def _should_interactive_prompt(
    cli: argparse.Namespace,
    *,
    no_prompt: bool,
    output_format: str,
) -> bool:
    # Human: TTY runs the full wizard unless --no-prompt or machine output modes.
    # Agent: --prompt forces wizard; SEC012_NO_PROMPT disables it for CI.
    if no_prompt or _env_bool("SEC012_NO_PROMPT"):
        return False
    if cli.prompt or _env_bool("SEC012_PROMPT"):
        return True
    if output_format != "human" or cli.quiet:
        return False
    return sys.stdin.isatty()


def _interactive_configure(
    cli: argparse.Namespace,
    cfg: Sec012Config,
    *,
    explicit_jwt_cli: str | None,
    try_dev_defaults: bool,
) -> Sec012Config:
    # Human: Walk operator through target URL, confirmation, credentials, optional JWT secret.
    # Agent: WRITES updated Sec012Config; RAISES SystemExit when exploit not confirmed.
    print(f"{AUDIT_ID} live exploit configuration:", file=sys.stderr)

    base = cfg.http.base_url
    entered_base = input(f"Target API base URL [{base}]: ").strip()
    if entered_base:
        base = entered_base.rstrip("/")
    url_err = _validate_base_url(base)
    if url_err:
        raise SystemExit(url_err)

    confirm = cfg.confirm_exploit
    if not confirm:
        if not _prompt_yes_no(
            "Run LIVE exploit? (creates admin accounts on the target instance)",
            default_no=True,
        ):
            raise SystemExit(f"{AUDIT_ID}: exploit not confirmed — aborting.")
        confirm = True

    email_default = cfg.exploit_email
    email_prompt = "Subject account email (admin or non-admin on target)"
    if email_default:
        email_prompt += f" [{email_default}]"
    email = input(f"{email_prompt}: ").strip() or email_default
    if not email:
        raise SystemExit(f"{AUDIT_ID}: subject email is required.")

    if cfg.exploit_password:
        password = getpass.getpass("Subject account password [Enter to keep current value]: ")
        if not password:
            password = cfg.exploit_password
    else:
        password = getpass.getpass("Subject account password: ")
    if not password:
        raise SystemExit(f"{AUDIT_ID}: subject password is required.")

    created_default = cfg.created_admin_email
    created_prompt = "New administrator name or email"
    if created_default:
        created_prompt += f" [{created_default}]"
    else:
        created_prompt += (
            f" [Enter for {CREATED_ADMIN_EMAIL_FALLBACK_PREFIX}-*@{CREATED_ADMIN_EMAIL_FALLBACK_DOMAIN}]"
        )
    created_raw = input(f"{created_prompt}: ").strip() or created_default
    try:
        created_admin_email = (
            normalize_created_admin_email(created_raw) if created_raw else ""
        )
    except ValueError as exc:
        raise SystemExit(f"{AUDIT_ID}: {exc}") from exc

    secrets = cfg.jwt_secrets
    if not secrets or cli.prompt or _env_bool("SEC012_PROMPT"):
        hint = "optional — Enter to use .env / Compose defaults"
        if secrets:
            hint = f"optional — Enter to keep {len(secrets)} loaded candidate(s)"
        jwt_input = getpass.getpass(f"JWT_SECRET ({hint}): ").strip()
        if jwt_input:
            secrets = tuple(
                resolve_jwt_secret_candidates(jwt_input, try_dev_defaults=try_dev_defaults)
            )
        elif not secrets:
            secrets = tuple(
                resolve_jwt_secret_candidates(explicit_jwt_cli, try_dev_defaults=try_dev_defaults)
            )

    http = Config(
        audit_id=cfg.http.audit_id,
        base_url=base,
        api_prefix=cfg.http.api_prefix,
        timeout_sec=cfg.http.timeout_sec,
        insecure_tls=cfg.http.insecure_tls,
        require_setup_complete=cfg.http.require_setup_complete,
        verbose=cfg.http.verbose,
        show_leaks=cfg.http.show_leaks,
        redact_output=cfg.http.redact_output,
        output_format=cfg.http.output_format,
        quiet=cfg.http.quiet,
        compact=cfg.http.compact,
        strict_heuristics=cfg.http.strict_heuristics,
        retries=cfg.http.retries,
        fail_fast=cfg.http.fail_fast,
        output_file=cfg.http.output_file,
        compare_baseline=cfg.http.compare_baseline,
        save_baseline=cfg.http.save_baseline,
    )
    return Sec012Config(
        http=http,
        confirm_exploit=confirm,
        exploit_email=email,
        exploit_password=password,
        instance_name=cfg.instance_name,
        jwt_secrets=secrets,
        try_jwt_forgery=cfg.try_jwt_forgery,
        try_dev_jwt_defaults=cfg.try_dev_jwt_defaults,
        admin_probe_route=cfg.admin_probe_route,
        created_admin_email=created_admin_email,
        bootstrap_via_admin=cfg.bootstrap_via_admin,
        prompt_credentials=True,
        no_prompt=cfg.no_prompt,
    )


def load_config(cli: argparse.Namespace | None = None) -> Sec012Config:
    global _LOADED_ENV_FILE
    if cli is None:
        cli = parse_cli()
    explicit_env = (cli.env_file or "").strip() or os.environ.get("SEC012_ENV_FILE", "").strip() or None
    _LOADED_ENV_FILE = load_sec012_env_file(explicit_env)
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC012_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC012_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC012_TIMEOUT_SEC", "30"))
    retries = cli.retries if cli.retries is not None else int(os.environ.get("SEC012_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC012_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC012_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC012_I_KNOW=1."
        )
    fmt = cli.output_format or os.environ.get("SEC012_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    explicit_jwt = (cli.jwt_secret or "").strip() or None
    try_dev = not cli.no_try_dev_defaults and not _env_bool("SEC012_NO_TRY_DEV_DEFAULTS")
    secrets = tuple(resolve_jwt_secret_candidates(explicit_jwt, try_dev_defaults=try_dev))
    try_forgery = not cli.skip_jwt_forgery and not _env_bool("SEC012_SKIP_JWT_FORGERY")
    no_prompt = cli.no_prompt or _env_bool("SEC012_NO_PROMPT")
    confirm_exploit = cli.confirm_exploit or _env_bool("SEC012_CONFIRM_EXPLOIT")
    exploit_email = (cli.exploit_email or "").strip() or os.environ.get("SEC012_EXPLOIT_EMAIL", "").strip()
    exploit_password = (cli.exploit_password or "").strip() or os.environ.get("SEC012_EXPLOIT_PASSWORD", "").strip()

    missing = _missing_non_interactive_fields(
        cli=cli,
        base_url=base,
        confirm_exploit=confirm_exploit,
        exploit_email=exploit_email,
        exploit_password=exploit_password,
        jwt_secrets=secrets,
    )

    if _should_interactive_prompt(cli, no_prompt=no_prompt, output_format=fmt):
        require_interactive_prompt(AUDIT_ID, missing=missing if missing else None)
    elif no_prompt and missing:
        raise SystemExit(
            f"{AUDIT_ID}: missing required configuration: {', '.join(missing)}. "
            "Use flags/env or run interactively on a TTY."
        )

    http = Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC012_INSECURE_TLS"),
        require_setup_complete=False,
        verbose=_env_bool("SEC012_VERBOSE"),
        show_leaks=_env_show_leaks(),
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC012_QUIET"),
        compact=cli.compact or _env_bool("SEC012_COMPACT"),
        strict_heuristics=False,
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC012_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC012_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC012_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline or os.environ.get("SEC012_SAVE_BASELINE", "").strip() or None,
    )
    created_raw = (cli.created_admin_email or "").strip() or os.environ.get(
        "SEC012_CREATED_ADMIN_EMAIL", ""
    ).strip()
    try:
        created_admin_email = (
            normalize_created_admin_email(created_raw) if created_raw else ""
        )
    except ValueError as exc:
        raise SystemExit(f"{AUDIT_ID}: {exc}") from exc

    cfg = Sec012Config(
        http=http,
        confirm_exploit=confirm_exploit,
        exploit_email=exploit_email,
        exploit_password=exploit_password,
        instance_name=(cli.instance_name or "").strip()
        or os.environ.get("SEC012_INSTANCE_NAME", "SEC012 Exploit Instance").strip(),
        jwt_secrets=secrets,
        try_jwt_forgery=try_forgery,
        try_dev_jwt_defaults=try_dev,
        admin_probe_route=(
            (cli.admin_probe_route or "").strip()
            or os.environ.get("SEC012_ADMIN_PROBE_ROUTE", DEFAULT_ADMIN_PROBE_ROUTE).strip()
            or DEFAULT_ADMIN_PROBE_ROUTE
        ),
        created_admin_email=created_admin_email,
        bootstrap_via_admin=not cli.no_bootstrap_via_admin
        and not _env_bool("SEC012_NO_BOOTSTRAP_VIA_ADMIN"),
        prompt_credentials=cli.prompt or _env_bool("SEC012_PROMPT"),
        no_prompt=no_prompt,
    )

    if _should_interactive_prompt(cli, no_prompt=no_prompt, output_format=fmt):
        cfg = _interactive_configure(cli, cfg, explicit_jwt_cli=explicit_jwt, try_dev_defaults=try_dev)

    return cfg
