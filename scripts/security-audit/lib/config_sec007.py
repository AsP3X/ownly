# Human: CLI and environment configuration for SEC-007 audit script.
# Agent: READS SEC007_* env and argparse; RETURNS Sec007Config.

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

from .config import _env_bool, require_interactive_prompt, should_prompt_missing_credentials
from .constants_sec007 import AUDIT_ID, DEFAULT_API_PREFIX, DEFAULT_BASE_URL, DEFAULT_SHARE_PASSWORD
from .env_file import SEC007_KEYS, inspect_env_file, load_sec007_env_file
from .models import Config, Sec007Config

_LOADED_ENV_FILE: Path | None = None
_ENV_EXPLICIT: str | None = None


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sec007_share_overview_password_bypass.py",
        description="SEC-007: password-protected share overview leaks metadata without password.",
    )
    parser.add_argument("--env-file", metavar="PATH", help="load SEC007_* from .env")
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="force credential prompt (default: prompt on TTY when credentials missing)",
    )
    parser.add_argument(
        "--no-prompt",
        action="store_true",
        help="never prompt; fail if credentials missing (SEC007_NO_PROMPT=1)",
    )
    parser.add_argument("--base-url", metavar="URL", help="API origin")
    parser.add_argument("--owner-email", metavar="EMAIL")
    parser.add_argument("--owner-password", metavar="PASSWORD")
    parser.add_argument(
        "--share-password",
        metavar="PASSWORD",
        help=f"visitor password for x-share-password (default {DEFAULT_SHARE_PASSWORD})",
    )
    parser.add_argument("--folder-id", metavar="ID")
    parser.add_argument("--file-id", metavar="ID")
    parser.add_argument("--share-id", metavar="ID")
    parser.add_argument("--share-token", metavar="TOKEN")
    parser.add_argument("--no-bootstrap", action="store_true")
    parser.add_argument("--no-revoke", action="store_true", help="leave probe share active")
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


def missing_credential_fields(cfg: Sec007Config) -> list[str]:
    missing: list[str] = []
    if not cfg.owner_email:
        missing.append("SEC007_OWNER_EMAIL")
    if not cfg.owner_password:
        missing.append("SEC007_OWNER_PASSWORD")
    return missing


def credential_setup_hint() -> str:
    return (
        "Add to .env (see .env.example) or run:\n"
        "  python3 scripts/security-audit/sec007_share_overview_password_bypass.py\n"
        "Export: SEC007_OWNER_EMAIL=... SEC007_OWNER_PASSWORD=... python3 scripts/security-audit/sec007_share_overview_password_bypass.py"
    )


def env_file_diagnostic() -> str | None:
    path, keys = inspect_env_file(_ENV_EXPLICIT, keys=SEC007_KEYS)
    hint = credential_setup_hint()
    if path is None:
        return f"No .env found (cwd={Path.cwd()}). {hint}"
    if not keys:
        return f"Found {path} but no SEC007_* variables.\n{hint}"
    still = missing_credential_fields(
        Sec007Config(
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
            owner_email=os.environ.get("SEC007_OWNER_EMAIL", "").strip(),
            owner_password=os.environ.get("SEC007_OWNER_PASSWORD", "").strip(),
            share_password=os.environ.get("SEC007_SHARE_PASSWORD", DEFAULT_SHARE_PASSWORD).strip(),
            folder_id="",
            file_id="",
            share_id="",
            share_token="",
            bootstrap_fixtures=True,
            revoke_after_probe=True,
        )
    )
    if still:
        return f"Found {path}; still missing: {', '.join(still)}"
    return None


def _prompt_owner(*, email: str, password: str) -> tuple[str, str]:
    print("SEC-007 owner credentials (password-protected share overview probe):", file=sys.stderr)
    if not email:
        email = input("Owner email: ").strip()
    if not password:
        password = getpass.getpass("Owner password: ")
    return email, password


def load_config(cli: argparse.Namespace | None = None) -> Sec007Config:
    global _LOADED_ENV_FILE, _ENV_EXPLICIT
    if cli is None:
        cli = parse_cli()
    _ENV_EXPLICIT = (cli.env_file or "").strip() or os.environ.get("SEC007_ENV_FILE", "").strip() or None
    _LOADED_ENV_FILE = load_sec007_env_file(_ENV_EXPLICIT)
    base = (
        (cli.base_url or "").strip()
        or os.environ.get("SEC007_BASE_URL", DEFAULT_BASE_URL).strip()
    ).rstrip("/")
    prefix = os.environ.get("SEC007_API_PREFIX", DEFAULT_API_PREFIX).strip()
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    prefix = prefix.rstrip("/")
    timeout = float(os.environ.get("SEC007_TIMEOUT_SEC", "15"))
    retries = cli.retries if cli.retries is not None else int(os.environ.get("SEC007_RETRIES", "0"))
    no_redaction = cli.no_redaction or _env_bool("SEC007_NO_REDACTION")
    if no_redaction and not sys.stdout.isatty() and not _env_bool("SEC007_I_KNOW"):
        raise SystemExit(
            "Refusing --no-redaction in non-interactive mode without SEC007_I_KNOW=1."
        )
    fmt = cli.output_format or os.environ.get("SEC007_OUTPUT", "human").strip().lower()
    if fmt not in ("human", "json", "sarif"):
        fmt = "human"
    owner_email = (cli.owner_email or "").strip() or os.environ.get("SEC007_OWNER_EMAIL", "").strip()
    owner_password = (cli.owner_password or os.environ.get("SEC007_OWNER_PASSWORD", "")).strip()
    missing = missing_credential_fields(
        Sec007Config(
            http=Config(
                audit_id=AUDIT_ID,
                base_url=base,
                api_prefix=prefix,
                timeout_sec=timeout,
                insecure_tls=False,
                require_setup_complete=True,
                verbose=False,
                show_leaks=True,
                redact_output=True,
                output_format=fmt,
                quiet=False,
                compact=False,
                strict_heuristics=False,
                retries=0,
                fail_fast=False,
                output_file=None,
                compare_baseline=None,
                save_baseline=None,
            ),
            owner_email=owner_email,
            owner_password=owner_password,
            share_password=DEFAULT_SHARE_PASSWORD,
            folder_id="",
            file_id="",
            share_id="",
            share_token="",
            bootstrap_fixtures=True,
            revoke_after_probe=True,
        )
    )
    if should_prompt_missing_credentials(
        explicit_prompt=cli.prompt,
        prompt_env_name="SEC007_PROMPT",
        no_prompt=cli.no_prompt,
        no_prompt_env_name="SEC007_NO_PROMPT",
        missing=missing,
    ):
        require_interactive_prompt("SEC-007", missing=missing)
        owner_email, owner_password = _prompt_owner(email=owner_email, password=owner_password)
    share_password = (
        (cli.share_password or "").strip()
        or os.environ.get("SEC007_SHARE_PASSWORD", DEFAULT_SHARE_PASSWORD).strip()
        or DEFAULT_SHARE_PASSWORD
    )
    http = Config(
        audit_id=AUDIT_ID,
        base_url=base,
        api_prefix=prefix,
        timeout_sec=timeout,
        insecure_tls=_env_bool("SEC007_INSECURE_TLS"),
        require_setup_complete=_env_bool("SEC007_REQUIRE_SETUP", default=True),
        verbose=_env_bool("SEC007_VERBOSE"),
        show_leaks=_env_bool("SEC007_SHOW_LEAKS", default=True),
        redact_output=not no_redaction,
        output_format=fmt,
        quiet=cli.quiet or _env_bool("SEC007_QUIET"),
        compact=cli.compact or _env_bool("SEC007_COMPACT"),
        strict_heuristics=False,
        retries=max(0, retries),
        fail_fast=cli.fail_fast or _env_bool("SEC007_FAIL_FAST"),
        output_file=cli.output_file or os.environ.get("SEC007_OUTPUT_FILE", "").strip() or None,
        compare_baseline=cli.compare_baseline
        or os.environ.get("SEC007_COMPARE_BASELINE", "").strip()
        or None,
        save_baseline=cli.save_baseline or os.environ.get("SEC007_SAVE_BASELINE", "").strip() or None,
    )
    bootstrap = not cli.no_bootstrap and not _env_bool("SEC007_NO_BOOTSTRAP", default=False)
    revoke = not cli.no_revoke and not _env_bool("SEC007_NO_REVOKE")
    return Sec007Config(
        http=http,
        owner_email=owner_email,
        owner_password=owner_password,
        share_password=share_password,
        folder_id=(cli.folder_id or "").strip() or os.environ.get("SEC007_FOLDER_ID", "").strip(),
        file_id=(cli.file_id or "").strip() or os.environ.get("SEC007_FILE_ID", "").strip(),
        share_id=(cli.share_id or "").strip() or os.environ.get("SEC007_SHARE_ID", "").strip(),
        share_token=(cli.share_token or "").strip() or os.environ.get("SEC007_SHARE_TOKEN", "").strip(),
        bootstrap_fixtures=bootstrap,
        revoke_after_probe=revoke,
    )
