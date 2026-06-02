# Human: CLI and environment configuration for SEC-008 audit script.
# Agent: READS SEC008_* env and argparse; RETURNS Sec008Config.

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .config import _env_bool
from .constants_sec008 import AUDIT_ID, DEFAULT_API_PREFIX, DEFAULT_BASE_URL, DEFAULT_PROBE_TARGETS
from .env_file import load_sec008_env_file
from .models import Config, Sec008Config

_LOADED_ENV_FILE: Path | None = None


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec008_setup_storage_ssrf.py",
        description="SEC-008: unauthenticated setup storage test SSRF / internal recon.",
    )
    parser.add_argument("--env-file", metavar="PATH", help="load SEC008_* from .env")
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


def load_config(cli: argparse.Namespace | None = None) -> Sec008Config:
    global _LOADED_ENV_FILE
    if cli is None:
        cli = parse_cli()
    explicit = (cli.env_file or "").strip() or os.environ.get("SEC008_ENV_FILE", "").strip() or None
    _LOADED_ENV_FILE = load_sec008_env_file(explicit)
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC008_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC008_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC008_TIMEOUT_SEC", "20"))
    retries = cli.retries if cli.retries is not None else int(os.environ.get("SEC008_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC008_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC008_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC008_I_KNOW=1."
        )
    fmt = cli.output_format or os.environ.get("SEC008_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    http = Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC008_INSECURE_TLS"),
        require_setup_complete=False,
        verbose=_env_bool("SEC008_VERBOSE"),
        show_leaks=True,
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC008_QUIET"),
        compact=cli.compact or _env_bool("SEC008_COMPACT"),
        strict_heuristics=False,
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC008_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC008_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC008_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline or os.environ.get("SEC008_SAVE_BASELINE", "").strip() or None,
    )
    require_pre_setup = cli.require_pre_setup or _env_bool("SEC008_REQUIRE_PRE_SETUP")
    return Sec008Config(http=http, require_pre_setup=require_pre_setup, probe_targets=DEFAULT_PROBE_TARGETS)
