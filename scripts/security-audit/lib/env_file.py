# Human: Optional .env loader for SEC audit credentials (stdlib only, no dotenv dep).
# Agent: READS KEY=VALUE lines; SETS os.environ only for allowed SEC00N_* keys when unset.

from __future__ import annotations

import os
import re
from pathlib import Path

SEC002_KEYS = frozenset(
    {
        "SEC002_BASE_URL",
        "SEC002_API_PREFIX",
        "SEC002_SUBJECT_EMAIL",
        "SEC002_SUBJECT_PASSWORD",
        "SEC002_DEMOTER_EMAIL",
        "SEC002_DEMOTER_PASSWORD",
        "SEC002_DEMOTE_ROLE",
        "SEC002_ADMIN_PROBE_ROUTE",
        "SEC002_REQUIRE_SETUP",
        "SEC002_NO_RESTORE",
        "SEC002_RETRIES",
        "SEC002_QUIET",
        "SEC002_OUTPUT",
        "SEC002_BOOTSTRAP_SUBJECT",
        "SEC002_PROMPT",
    }
)

SEC003_KEYS = frozenset(
    {
        "SEC003_BASE_URL",
        "SEC003_API_PREFIX",
        "SEC003_OWNER_EMAIL",
        "SEC003_OWNER_PASSWORD",
        "SEC003_SHARE_PASSWORD",
        "SEC003_FOLDER_ID",
        "SEC003_FILE_ID",
        "SEC003_SHARE_TOKEN",
        "SEC003_REQUIRE_SETUP",
        "SEC003_NO_RESTORE",
        "SEC003_BOOTSTRAP_FIXTURES",
        "SEC003_RETRIES",
        "SEC003_QUIET",
        "SEC003_OUTPUT",
        "SEC003_PROMPT",
    }
)

SEC004_KEYS = frozenset(
    {
        "SEC004_BASE_URL",
        "SEC004_API_PREFIX",
        "SEC004_OWNER_EMAIL",
        "SEC004_OWNER_PASSWORD",
        "SEC004_FILE_ID",
        "SEC004_REQUIRE_SETUP",
        "SEC004_NO_RESTORE",
        "SEC004_NO_BOOTSTRAP",
        "SEC004_RETRIES",
        "SEC004_QUIET",
        "SEC004_OUTPUT",
        "SEC004_PROMPT",
    }
)

_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def parse_env_file(path: Path, *, keys: frozenset[str] = SEC002_KEYS) -> dict[str, str]:
    # Human: Parse a simple .env file into a dict (no variable expansion).
    # Agent: RETURNS only allowed SEC00N_* entries present in the file.
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = _LINE.match(line)
        if not match:
            continue
        key, value = match.group(1), _strip_quotes(match.group(2).strip())
        if key in keys:
            out[key] = value
    return out


def apply_env_file(
    path: Path,
    *,
    keys: frozenset[str] = SEC002_KEYS,
    overwrite: bool = False,
) -> int:
    # Human: Load SEC00N_* from path into os.environ for the current process.
    # Agent: RETURNS count of keys applied; skips existing env unless overwrite.
    applied = 0
    for key, value in parse_env_file(path, keys=keys).items():
        if not overwrite and os.environ.get(key, "").strip():
            continue
        os.environ[key] = value
        applied += 1
    return applied


def discover_env_file(explicit: str | None) -> Path | None:
    # Human: Resolve .env path — explicit flag/env, then cwd, then repo root near this package.
    if explicit:
        p = Path(explicit).expanduser()
        return p if p.is_file() else None
    candidates: list[Path] = [Path.cwd() / ".env"]
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / ".env").is_file():
            candidates.append(parent / ".env")
        if (parent / "docker-compose.yml").is_file():
            candidates.append(parent / ".env")
            break
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_file():
            return resolved
    return None


def _load_env_file_for_keys(
    explicit: str | None,
    keys: frozenset[str],
) -> Path | None:
    path = discover_env_file(explicit)
    if path is None:
        return None
    if apply_env_file(path, keys=keys):
        return path
    if parse_env_file(path, keys=keys):
        return path
    return None


def load_sec002_env_file(explicit: str | None = None) -> Path | None:
    # Human: Best-effort load of SEC002_* from discovered .env before config load.
    # Agent: RETURNS path loaded or None; does not override already-exported vars.
    return _load_env_file_for_keys(explicit, SEC002_KEYS)


def load_sec003_env_file(explicit: str | None = None) -> Path | None:
    # Human: Best-effort load of SEC003_* from discovered .env before config load.
    # Agent: RETURNS path loaded or None; does not override already-exported vars.
    return _load_env_file_for_keys(explicit, SEC003_KEYS)


def load_sec004_env_file(explicit: str | None = None) -> Path | None:
    # Human: Best-effort load of SEC004_* from discovered .env before config load.
    # Agent: RETURNS path loaded or None; does not override already-exported vars.
    return _load_env_file_for_keys(explicit, SEC004_KEYS)


def inspect_env_file(
    explicit: str | None = None,
    *,
    keys: frozenset[str] = SEC002_KEYS,
) -> tuple[Path | None, dict[str, str]]:
    # Human: Locate .env and return parsed SEC00N_* keys (without applying).
    # Agent: USED for credential setup diagnostics when the audit cannot run.
    path = discover_env_file(explicit)
    if path is None:
        return None, {}
    return path, parse_env_file(path, keys=keys)
