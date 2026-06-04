# Human: CLI and environment configuration for SEC-010 audit script.
# Agent: READS SEC010_* env and argparse; RETURNS Sec010Config.

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .config import _env_bool
from .constants_sec010 import AUDIT_ID, DEFAULT_API_PREFIX, DEFAULT_BASE_URL, DEFAULT_PROBE_TARGETS
from .env_file import load_sec010_env_file
from .models import Config, Sec010Config

_LOADED_ENV_FILE: Path | None = None


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec010_setup_database_ssrf.py",
        description="SEC-010: unauthenticated setup database test internal Postgres probing.",
    )
    parser.add_argument("--env-file", metavar="PATH", help="load SEC010_* from .env")
    parser.add_argument("--base-url", metavar="URL", help="API origin")
    parser.add_argument(
        "--require-pre-setup",
        action="store_true",
        help="exit inconclusive when setup_complete=true (default: still check post-setup gating)",
    )
    parser.add_argument("--no-redaction", action="store_true")
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


def load_config(cli: argparse.Namespace | None = None) -> Sec010Config:
    global _LOADED_ENV_FILE
    if cli is None:
        cli = parse_cli()
    explicit = (cli.env_file or "").strip() or os.environ.get("SEC010_ENV_FILE", "").strip() or None
    _LOADED_ENV_FILE = load_sec010_env_file(explicit)
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC010_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC010_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC010_TIMEOUT_SEC", "20"))
    retries = cli.retries if cli.retries is not None else int(os.environ.get("SEC010_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC010_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC010_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC010_I_KNOW=1."
        )
    fmt = cli.output_format or os.environ.get("SEC010_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    http = Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC010_INSECURE_TLS"),
        require_setup_complete=False,
        verbose=_env_bool("SEC010_VERBOSE"),
        show_leaks=True,
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC010_QUIET"),
        compact=cli.compact or _env_bool("SEC010_COMPACT"),
        strict_heuristics=False,
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC010_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC010_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC010_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline or os.environ.get("SEC010_SAVE_BASELINE", "").strip() or None,
    )
    require_pre_setup = cli.require_pre_setup or _env_bool("SEC010_REQUIRE_PRE_SETUP")
    return Sec010Config(http=http, require_pre_setup=require_pre_setup, probe_targets=DEFAULT_PROBE_TARGETS)
