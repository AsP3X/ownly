# Human: Optional .env loader for SEC-002 credentials (stdlib only, no dotenv dep).
# Agent: READS KEY=VALUE lines; SETS os.environ only for allowed SEC002_* keys when unset.

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

_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def parse_env_file(path: Path) -> dict[str, str]:
    # Human: Parse a simple .env file into a dict (no variable expansion).
    # Agent: RETURNS only SEC002_* entries present in the file.
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
        if key in SEC002_KEYS:
            out[key] = value
    return out


def apply_env_file(path: Path, *, overwrite: bool = False) -> int:
    # Human: Load SEC002_* from path into os.environ for the current process.
    # Agent: RETURNS count of keys applied; skips existing env unless overwrite.
    applied = 0
    for key, value in parse_env_file(path).items():
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


def load_sec002_env_file(explicit: str | None = None) -> Path | None:
    # Human: Best-effort load of SEC002_* from discovered .env before config load.
    # Agent: RETURNS path loaded or None; does not override already-exported vars.
    path = discover_env_file(explicit)
    if path is None:
        return None
    if apply_env_file(path):
        return path
    # File exists but had no SEC002_* keys (or all already set).
    if parse_env_file(path):
        return path
    return None


def inspect_env_file(explicit: str | None = None) -> tuple[Path | None, dict[str, str]]:
    # Human: Locate .env and return parsed SEC002_* keys (without applying).
    # Agent: USED for credential setup diagnostics when the audit cannot run.
    path = discover_env_file(explicit)
    if path is None:
        return None, {}
    return path, parse_env_file(path)
