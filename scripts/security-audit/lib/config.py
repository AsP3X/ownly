# Human: CLI and environment configuration for security audit scripts.
# Agent: READS os.environ and argparse; RETURNS Config.

from __future__ import annotations

import argparse
import os
import sys

from .constants import AUDIT_ID, DEFAULT_API_PREFIX, DEFAULT_BASE_URL
from .models import Config


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def should_prompt_missing_credentials(
    *,
    explicit_prompt: bool,
    prompt_env_name: str,
    missing: list[str],
    no_prompt: bool = False,
    no_prompt_env_name: str = "",
) -> bool:
    # Human: Decide whether to ask the operator for credentials on this run.
    # Agent: RETURNS False when complete or SEC00N_NO_PROMPT; True on TTY when fields missing.
    if not missing:
        return False
    if no_prompt or (no_prompt_env_name and _env_bool(no_prompt_env_name)):
        return False
    if explicit_prompt or (prompt_env_name and _env_bool(prompt_env_name)):
        return True
    return sys.stdin.isatty()


def require_interactive_prompt(audit_id: str, *, missing: list[str] | None = None) -> None:
    # Human: Guard before input()/getpass when --prompt or auto-prompt was requested.
    # Agent: RAISES SystemExit when stdin is not a TTY (CI must use env vars or SEC00N_NO_PROMPT).
    if sys.stdin.isatty():
        return
    detail = f" Missing: {', '.join(missing)}." if missing else ""
    raise SystemExit(
        f"{audit_id}: interactive credential prompt requires a TTY.{detail} "
        "Set SEC00N_* env vars, pass CLI flags, or use SEC00N_NO_PROMPT=1 in non-interactive CI."
    )


def _env_show_leaks() -> bool:
    raw = os.environ.get("SEC001_SHOW_LEAKS", "").strip().lower()
    if not raw:
        return True
    return raw not in ("0", "false", "no", "off")


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec001_setup_info_disclosure.py",
        description="SEC-001: unauthenticated setup/database and setup/storage disclosure audit.",
    )
    parser.add_argument(
        "--base-url",
        metavar="URL",
        help="API origin (default: SEC001_BASE_URL or http://127.0.0.1:8080)",
    )
    parser.add_argument(
        "--no-redaction",
        action="store_true",
        help="print raw leaked values (default: redact secrets in output)",
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
        help="collapse duplicate per-endpoint checklist lines",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="stricter credential heuristics (may increase false positives)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=None,
        metavar="N",
        help="retry unreachable target N times (default: 0, or SEC001_RETRIES)",
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


def load_config(cli: argparse.Namespace | None = None) -> Config:
    if cli is None:
        cli = parse_cli()
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC001_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC001_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC001_TIMEOUT_SEC", "15"))
    retries = cli.retries
    if retries is None:
        retries = int(os.environ.get("SEC001_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC001_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC001_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC001_I_KNOW=1 "
            "(prevents accidental secret logging in CI)."
        )
    fmt = cli.output_format or os.environ.get("SEC001_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    return Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC001_INSECURE_TLS"),
        require_setup_complete=_env_bool("SEC001_REQUIRE_SETUP"),
        verbose=_env_bool("SEC001_VERBOSE"),
        show_leaks=_env_show_leaks(),
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC001_QUIET"),
        compact=cli.compact or _env_bool("SEC001_COMPACT"),
        strict_heuristics=cli.strict or _env_bool("SEC001_STRICT"),
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC001_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC001_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC001_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline
        or os.environ.get("SEC001_SAVE_BASELINE", "").strip()
        or None,
    )
