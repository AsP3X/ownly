# Human: CLI and environment configuration for SEC-012 exploit script.
# Agent: READS SEC012_* and JWT_SECRET from .env; RETURNS Sec012Config.

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

from .config import _env_bool, require_interactive_prompt, should_prompt_missing_credentials
from .constants_sec012 import (
    AUDIT_ID,
    DEFAULT_ADMIN_PROBE_ROUTE,
    DEFAULT_API_PREFIX,
    DEFAULT_BASE_URL,
)
from .env_file import load_sec012_env_file
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
    parser.add_argument("--base-url", metavar="URL", help="API origin")
    parser.add_argument(
        "--confirm-exploit",
        action="store_true",
        help="run live exploit (required for mutations)",
    )
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="prompt for subject login email/password when missing (initialized instances)",
    )
    parser.add_argument(
        "--no-prompt",
        action="store_true",
        help="never prompt; fail if subject credentials missing",
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
        help="new admin row to insert via POST /admin/users (default: sec012-created-*@audit.invalid)",
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
        help="do not try change-me-in-production and other dev defaults",
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


def _maybe_prompt_subject_credentials(cfg: Sec012Config, cli: argparse.Namespace) -> Sec012Config:
    missing: list[str] = []
    if not cfg.exploit_email:
        missing.append("subject email")
    if not cfg.exploit_password:
        missing.append("subject password")
    if not should_prompt_missing_credentials(
        explicit_prompt=cli.prompt,
        prompt_env_name="SEC012_PROMPT",
        missing=missing,
        no_prompt=cfg.no_prompt,
        no_prompt_env_name="SEC012_NO_PROMPT",
    ):
        return cfg
    require_interactive_prompt(AUDIT_ID, missing=missing)
    email = cfg.exploit_email or input("Subject account email (any non-admin user): ").strip()
    password = cfg.exploit_password or getpass.getpass("Subject account password: ")
    return Sec012Config(
        http=cfg.http,
        confirm_exploit=cfg.confirm_exploit,
        exploit_email=email,
        exploit_password=password,
        instance_name=cfg.instance_name,
        jwt_secrets=cfg.jwt_secrets,
        try_jwt_forgery=cfg.try_jwt_forgery,
        try_dev_jwt_defaults=cfg.try_dev_jwt_defaults,
        admin_probe_route=cfg.admin_probe_route,
        created_admin_email=cfg.created_admin_email,
        bootstrap_via_admin=cfg.bootstrap_via_admin,
        prompt_credentials=cfg.prompt_credentials,
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
    secrets = tuple(
        resolve_jwt_secret_candidates(explicit_jwt, try_dev_defaults=try_dev)
    )
    try_forgery = not cli.skip_jwt_forgery and not _env_bool("SEC012_SKIP_JWT_FORGERY")
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
    cfg = Sec012Config(
        http=http,
        confirm_exploit=cli.confirm_exploit or _env_bool("SEC012_CONFIRM_EXPLOIT"),
        exploit_email=(cli.exploit_email or "").strip()
        or os.environ.get("SEC012_EXPLOIT_EMAIL", "").strip(),
        exploit_password=(cli.exploit_password or "").strip()
        or os.environ.get("SEC012_EXPLOIT_PASSWORD", "").strip(),
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
        created_admin_email=(cli.created_admin_email or "").strip()
        or os.environ.get("SEC012_CREATED_ADMIN_EMAIL", "").strip(),
        bootstrap_via_admin=not cli.no_bootstrap_via_admin
        and not _env_bool("SEC012_NO_BOOTSTRAP_VIA_ADMIN"),
        prompt_credentials=cli.prompt or _env_bool("SEC012_PROMPT"),
        no_prompt=cli.no_prompt or _env_bool("SEC012_NO_PROMPT"),
    )
    return _maybe_prompt_subject_credentials(cfg, cli)
