# Human: CLI and environment configuration for SEC-002 audit script.
# Agent: READS SEC002_* env and argparse; RETURNS Sec002Config.

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

from .config import _env_bool
from .constants_sec002 import (
    AUDIT_ID,
    DEFAULT_ADMIN_PROBE_ROUTE,
    DEFAULT_API_PREFIX,
    DEFAULT_BASE_URL,
    DEFAULT_DEMOTE_ROLE,
)
from .env_file import inspect_env_file, load_sec002_env_file
from .models import Config, Sec002Config

_LOADED_ENV_FILE: Path | None = None
_ENV_EXPLICIT: str | None = None


def _env_show_leaks() -> bool:
    raw = os.environ.get("SEC002_SHOW_LEAKS", "").strip().lower()
    if not raw:
        return True
    return raw not in ("0", "false", "no", "off")


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec002_stale_jwt_admin_role.py",
        description="SEC-002: stale JWT admin role after demotion audit.",
    )
    parser.add_argument(
        "--env-file",
        metavar="PATH",
        help="load SEC002_* from .env (default: repo .env if present; SEC002_ENV_FILE)",
    )
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="prompt for missing credentials on a TTY (or SEC002_PROMPT=1)",
    )
    parser.add_argument(
        "--bootstrap-subject",
        action="store_true",
        help="create temporary subject admin via demoter (only SEC002_DEMOTER_* required)",
    )
    parser.add_argument(
        "--base-url",
        metavar="URL",
        help="API origin (default: SEC002_BASE_URL or http://127.0.0.1:8080)",
    )
    parser.add_argument(
        "--subject-email",
        metavar="EMAIL",
        help="admin account to demote (SEC002_SUBJECT_EMAIL)",
    )
    parser.add_argument(
        "--subject-password",
        metavar="PASSWORD",
        help="subject password (SEC002_SUBJECT_PASSWORD)",
    )
    parser.add_argument(
        "--demoter-email",
        metavar="EMAIL",
        help="second admin that performs demotion (SEC002_DEMOTER_EMAIL)",
    )
    parser.add_argument(
        "--demoter-password",
        metavar="PASSWORD",
        help="demoter password (SEC002_DEMOTER_PASSWORD)",
    )
    parser.add_argument(
        "--demote-role",
        metavar="ROLE",
        default=None,
        help=f"role after demotion (default: {DEFAULT_DEMOTE_ROLE})",
    )
    parser.add_argument(
        "--admin-probe-route",
        metavar="PATH",
        default=None,
        help=f"admin route to probe (default: {DEFAULT_ADMIN_PROBE_ROUTE})",
    )
    parser.add_argument(
        "--no-restore",
        action="store_true",
        help="leave subject demoted after run (default: restore admin role)",
    )
    parser.add_argument(
        "--no-redaction",
        action="store_true",
        help="print raw JWTs in output (default: redact tokens)",
    )
    parser.add_argument(
        "--json",
        action="store_const",
        const="json",
        dest="output_format",
        help="machine-readable JSON on stdout",
    )
    parser.add_argument(
        "--sarif",
        action="store_const",
        const="sarif",
        dest="output_format",
        help="SARIF 2.1.0 for CI security tabs",
    )
    parser.add_argument("--quiet", action="store_true", help="exit code only; no human report")
    parser.add_argument(
        "--compact",
        action="store_true",
        help="collapse duplicate per-step checklist lines",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=None,
        metavar="N",
        help="retry unreachable target N times (default: 0, or SEC002_RETRIES)",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="stop after first vulnerability (fail) finding",
    )
    parser.add_argument(
        "--output-file",
        metavar="PATH",
        help="write redacted JSON report to PATH",
    )
    parser.add_argument(
        "--save-baseline",
        metavar="PATH",
        help="save redacted JSON report as baseline for --compare-baseline",
    )
    parser.add_argument(
        "--compare-baseline",
        metavar="PATH",
        help="fail if redacted report differs from saved baseline",
    )
    return parser.parse_args(argv)


def loaded_env_file_path() -> Path | None:
    return _LOADED_ENV_FILE


def missing_credential_fields(cfg: Sec002Config) -> list[str]:
    missing: list[str] = []
    if not cfg.demoter_email:
        missing.append("SEC002_DEMOTER_EMAIL")
    if not cfg.demoter_password:
        missing.append("SEC002_DEMOTER_PASSWORD")
    if cfg.bootstrap_subject:
        return missing
    if not cfg.subject_email:
        missing.append("SEC002_SUBJECT_EMAIL")
    if not cfg.subject_password:
        missing.append("SEC002_SUBJECT_PASSWORD")
    return missing


def shell_export_hint() -> str:
    # Human: zsh/bash assignments without export are not visible to python3 child processes.
    return (
        "Shell note: SEC002_* lines must be exported, on the same line as python3, "
        "passed as CLI flags, or stored in repo .env — e.g.\n"
        "  export SEC002_DEMOTER_EMAIL='you@example.com'\n"
        "  export SEC002_DEMOTER_PASSWORD='...'\n"
        "  python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --bootstrap-subject\n"
        "Or one line:\n"
        "  SEC002_DEMOTER_EMAIL='you@example.com' SEC002_DEMOTER_PASSWORD='...' "
        "python3 scripts/security-audit/sec002_stale_jwt_admin_role.py --bootstrap-subject"
    )


def credential_setup_hint(*, bootstrap: bool = False) -> str:
    # Human: Copy-paste template for local .env (gitignored).
    script = "scripts/security-audit/sec002_stale_jwt_admin_role.py"
    if bootstrap:
        return (
            f"Bootstrap: add to repo .env, or export, or CLI flags:\n"
            f"  python3 {script} --bootstrap-subject \\\n"
            f"    --demoter-email 'you@example.com' --demoter-password '...'\n"
            f"Or: python3 {script} --bootstrap-subject --prompt\n"
            f"{shell_export_hint()}"
        )
    return (
        "Add to your repo .env (see .env.example) or export SEC002_* vars.\n"
        f"Or one admin: python3 {script} --bootstrap-subject --prompt\n"
        f"Or two admins: python3 {script} --prompt\n"
        f"{shell_export_hint()}"
    )


def env_file_diagnostic(*, bootstrap: bool = False) -> str | None:
    path, keys = inspect_env_file(_ENV_EXPLICIT)
    hint = credential_setup_hint(bootstrap=bootstrap)
    if path is None:
        return f"No .env found (cwd={Path.cwd()}). {hint}"
    if not keys:
        return f"Found {path} but no SEC002_* variables.\n{hint}"
    present = ", ".join(sorted(keys))
    still = missing_credential_fields(
        Sec002Config(
            http=Config(
                audit_id=AUDIT_ID,
                base_url="",
                api_prefix="",
                timeout_sec=1.0,
                insecure_tls=False,
                require_setup_complete=True,
                verbose=False,
                show_leaks=True,
                redact_output=True,
                output_format="human",
                quiet=False,
                compact=False,
                strict_heuristics=False,
                retries=0,
                fail_fast=False,
                output_file=None,
                compare_baseline=None,
                save_baseline=None,
            ),
            subject_email=os.environ.get("SEC002_SUBJECT_EMAIL", "").strip(),
            subject_password=os.environ.get("SEC002_SUBJECT_PASSWORD", "").strip(),
            demoter_email=os.environ.get("SEC002_DEMOTER_EMAIL", "").strip(),
            demoter_password=os.environ.get("SEC002_DEMOTER_PASSWORD", "").strip(),
            demote_role="pro",
            admin_probe_route="/admin/users",
            restore_admin_role=True,
            bootstrap_subject=False,
        )
    )
    if still:
        return f"Found {path} with {present}; still missing: {', '.join(still)}"
    return None


def _prompt_credentials(
    *,
    subject_email: str,
    subject_password: str,
    demoter_email: str,
    demoter_password: str,
    bootstrap: bool,
) -> tuple[str, str, str, str]:
    if not sys.stdin.isatty():
        raise SystemExit("SEC-002 --prompt requires an interactive terminal.")
    if bootstrap:
        print("SEC-002 demoter admin (creates temporary subject via --bootstrap-subject):", file=sys.stderr)
    else:
        print("SEC-002 credentials (two distinct admin accounts):", file=sys.stderr)
    if not bootstrap:
        if not subject_email:
            subject_email = input("Subject admin email (demoted): ").strip()
        if not subject_password:
            subject_password = getpass.getpass("Subject password: ")
    if not demoter_email:
        demoter_email = input("Demoter admin email (performs PATCH): ").strip()
    if not demoter_password:
        demoter_password = getpass.getpass("Demoter password: ")
    return subject_email, subject_password, demoter_email, demoter_password


def load_config(cli: argparse.Namespace | None = None) -> Sec002Config:
    global _LOADED_ENV_FILE, _ENV_EXPLICIT
    if cli is None:
        cli = parse_cli()
    _ENV_EXPLICIT = (cli.env_file or "").strip() or os.environ.get("SEC002_ENV_FILE", "").strip() or None
    _LOADED_ENV_FILE = load_sec002_env_file(_ENV_EXPLICIT)
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC002_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC002_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC002_TIMEOUT_SEC", "15"))
    retries = cli.retries
    if retries is None:
        retries = int(os.environ.get("SEC002_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC002_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC002_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC002_I_KNOW=1 "
            "(prevents accidental JWT logging in CI)."
        )
    fmt = cli.output_format or os.environ.get("SEC002_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    subject_email = (
        (cli.subject_email or "").strip()
        or os.environ.get("SEC002_SUBJECT_EMAIL", "").strip()
    )
    subject_password = (
        cli.subject_password or os.environ.get("SEC002_SUBJECT_PASSWORD", "")
    ).strip()
    demoter_email = (
        (cli.demoter_email or "").strip() or os.environ.get("SEC002_DEMOTER_EMAIL", "").strip()
    )
    demoter_password = (
        cli.demoter_password or os.environ.get("SEC002_DEMOTER_PASSWORD", "")
    ).strip()
    demote_role = (
        (cli.demote_role or "").strip()
        or os.environ.get("SEC002_DEMOTE_ROLE", DEFAULT_DEMOTE_ROLE).strip()
    )
    probe_route = (
        (cli.admin_probe_route or "").strip()
        or os.environ.get("SEC002_ADMIN_PROBE_ROUTE", DEFAULT_ADMIN_PROBE_ROUTE).strip()
    )
    if not probe_route.startswith("/"):
        probe_route = "/" + probe_route
    http = Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC002_INSECURE_TLS"),
        require_setup_complete=_env_bool("SEC002_REQUIRE_SETUP", default=True),
        verbose=_env_bool("SEC002_VERBOSE"),
        show_leaks=_env_show_leaks(),
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC002_QUIET"),
        compact=cli.compact or _env_bool("SEC002_COMPACT"),
        strict_heuristics=False,
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC002_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC002_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC002_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline
        or os.environ.get("SEC002_SAVE_BASELINE", "").strip()
        or None,
    )
    restore = not cli.no_restore and not _env_bool("SEC002_NO_RESTORE")
    bootstrap = cli.bootstrap_subject or _env_bool("SEC002_BOOTSTRAP_SUBJECT")
    if bootstrap:
        restore = False
    want_prompt = cli.prompt or _env_bool("SEC002_PROMPT")
    if want_prompt:
        subject_email, subject_password, demoter_email, demoter_password = _prompt_credentials(
            subject_email=subject_email,
            subject_password=subject_password,
            demoter_email=demoter_email,
            demoter_password=demoter_password,
            bootstrap=bootstrap,
        )
    return Sec002Config(
        http=http,
        subject_email=subject_email,
        subject_password=subject_password,
        demoter_email=demoter_email,
        demoter_password=demoter_password,
        demote_role=demote_role,
        admin_probe_route=probe_route,
        restore_admin_role=restore,
        bootstrap_subject=bootstrap,
    )
