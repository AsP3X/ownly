# Human: CLI and environment configuration for SEC-005 audit script.
# Agent: READS SEC005_* env and argparse; RETURNS Sec005Config.

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .config import _env_bool
from .constants_sec005 import (
    AUDIT_ID,
    DEFAULT_API_PREFIX,
    DEFAULT_BASE_URL,
    DEFAULT_BOOTSTRAP_HEADER,
)
from .env_file import inspect_env_file, load_sec005_env_file
from .models import Config, Sec005Config

_LOADED_ENV_FILE: Path | None = None
_ENV_EXPLICIT: str | None = None


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec005_setup_bootstrap_race.py",
        description="SEC-005: unauthenticated setup bootstrap and missing bootstrap-token gate.",
    )
    parser.add_argument("--env-file", metavar="PATH", help="load SEC005_* from .env")
    parser.add_argument("--base-url", metavar="URL", help="API origin")
    parser.add_argument(
        "--bootstrap-header",
        metavar="NAME",
        help=f"header probed for bootstrap token (default: {DEFAULT_BOOTSTRAP_HEADER})",
    )
    parser.add_argument(
        "--require-setup-complete",
        action="store_true",
        help="exit inconclusive when setup_complete=false (default: probe pre-setup too)",
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


def _env_show_leaks() -> bool:
    raw = os.environ.get("SEC005_SHOW_LEAKS", "").strip().lower()
    if not raw:
        return True
    return raw not in ("0", "false", "no", "off")


def load_config(cli: argparse.Namespace | None = None) -> Sec005Config:
    global _LOADED_ENV_FILE, _ENV_EXPLICIT
    if cli is None:
        cli = parse_cli()
    _ENV_EXPLICIT = (cli.env_file or "").strip() or os.environ.get("SEC005_ENV_FILE", "").strip() or None
    _LOADED_ENV_FILE = load_sec005_env_file(_ENV_EXPLICIT)
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC005_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC005_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC005_TIMEOUT_SEC", "15"))
    retries = cli.retries if cli.retries is not None else int(os.environ.get("SEC005_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC005_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC005_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC005_I_KNOW=1."
        )
    fmt = cli.output_format or os.environ.get("SEC005_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    header = (
        (cli.bootstrap_header or "").strip()
        or os.environ.get("SEC005_BOOTSTRAP_HEADER", DEFAULT_BOOTSTRAP_HEADER).strip()
        or DEFAULT_BOOTSTRAP_HEADER
    )
    require_complete = cli.require_setup_complete or _env_bool("SEC005_REQUIRE_SETUP_COMPLETE")
    http = Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC005_INSECURE_TLS"),
        require_setup_complete=require_complete,
        verbose=_env_bool("SEC005_VERBOSE"),
        show_leaks=_env_show_leaks(),
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC005_QUIET"),
        compact=cli.compact or _env_bool("SEC005_COMPACT"),
        strict_heuristics=False,
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC005_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC005_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC005_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline or os.environ.get("SEC005_SAVE_BASELINE", "").strip() or None,
    )
    return Sec005Config(http=http, bootstrap_header=header)
