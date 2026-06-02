# Human: CLI and environment configuration for SEC-006 audit script.
# Agent: READS SEC006_* env and argparse; RETURNS Sec006Config.

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .config import _env_bool
from .constants_sec006 import (
    AUDIT_ID,
    DEFAULT_API_PREFIX,
    DEFAULT_BASE_URL,
    DEFAULT_LOGIN_RPM,
    DEFAULT_REGISTER_RPM,
)
from .env_file import load_sec006_env_file
from .models import Config, Sec006Config

_LOADED_ENV_FILE: Path | None = None


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec006_rate_limit_forwarded_headers.py",
        description="SEC-006: login/register rate limit bypass via spoofed forwarding headers.",
    )
    parser.add_argument("--env-file", metavar="PATH", help="load SEC006_* from .env")
    parser.add_argument("--base-url", metavar="URL", help="API origin")
    parser.add_argument(
        "--login-rpm",
        type=int,
        default=None,
        metavar="N",
        help=f"expected login requests/min cap (default {DEFAULT_LOGIN_RPM})",
    )
    parser.add_argument(
        "--register-rpm",
        type=int,
        default=None,
        metavar="N",
        help=f"expected register requests/min cap (default {DEFAULT_REGISTER_RPM})",
    )
    parser.add_argument(
        "--skip-register",
        action="store_true",
        help="only probe POST /auth/login",
    )
    parser.add_argument("--no-redaction", action="store_true", help="print raw values in output")
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


def load_config(cli: argparse.Namespace | None = None) -> Sec006Config:
    global _LOADED_ENV_FILE
    if cli is None:
        cli = parse_cli()
    explicit = (cli.env_file or "").strip() or os.environ.get("SEC006_ENV_FILE", "").strip() or None
    _LOADED_ENV_FILE = load_sec006_env_file(explicit)
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC006_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC006_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC006_TIMEOUT_SEC", "30"))
    retries = cli.retries if cli.retries is not None else int(os.environ.get("SEC006_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC006_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC006_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC006_I_KNOW=1."
        )
    fmt = cli.output_format or os.environ.get("SEC006_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    login_rpm = cli.login_rpm
    if login_rpm is None:
        login_rpm = int(os.environ.get("SEC006_LOGIN_RPM", str(DEFAULT_LOGIN_RPM)))
    register_rpm = cli.register_rpm
    if register_rpm is None:
        register_rpm = int(os.environ.get("SEC006_REGISTER_RPM", str(DEFAULT_REGISTER_RPM)))
    login_rpm = max(1, login_rpm)
    register_rpm = max(1, register_rpm)
    http = Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC006_INSECURE_TLS"),
        require_setup_complete=_env_bool("SEC006_REQUIRE_SETUP", default=True),
        verbose=_env_bool("SEC006_VERBOSE"),
        show_leaks=True,
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC006_QUIET"),
        compact=cli.compact or _env_bool("SEC006_COMPACT"),
        strict_heuristics=False,
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC006_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC006_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC006_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline or os.environ.get("SEC006_SAVE_BASELINE", "").strip() or None,
    )
    probe_register = not cli.skip_register and not _env_bool("SEC006_SKIP_REGISTER")
    return Sec006Config(
        http=http,
        login_rpm=login_rpm,
        register_rpm=register_rpm,
        probe_register=probe_register,
    )
