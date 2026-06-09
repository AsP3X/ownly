#!/usr/bin/env python3
# Human: Compare Ownly Postgres logical bytes to Nebular on-disk blob sizes (ops / tuning).
# Agent: READS DATABASE_URL + NEBULAR_DATA_DIR; SUM files.size_bytes; WALKS blob tree; CLASSIFIES NOSI/legacy/raw.

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# Human: Keys loaded from repo .env when not already exported in the shell.
# Agent: READS DATABASE_URL, NEBULAR_DATA_DIR; does not override existing os.environ.
_STORAGE_ENV_KEYS = frozenset({"DATABASE_URL", "NEBULAR_DATA_DIR"})
_ENV_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")

try:
    import psycopg
except ImportError:
    print(
        "storage-audit: install psycopg (e.g. pip install 'psycopg[binary]') or run from an env that has it",
        file=sys.stderr,
    )
    sys.exit(2)

NOSI_MAGIC = b"NOSI"
NOSB_MAGIC = b"NOSB"
NOSZ_MAGIC = b"NOSZ"
NOS2_MAGIC = b"NOS2"


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _parse_env_file(path: Path) -> dict[str, str]:
    # Human: Parse KEY=VALUE lines from a .env file (no variable expansion).
    # Agent: RETURNS only DATABASE_URL and NEBULAR_DATA_DIR when present.
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = _ENV_LINE.match(line)
        if not match:
            continue
        key, value = match.group(1), _strip_quotes(match.group(2).strip())
        if key in _STORAGE_ENV_KEYS:
            out[key] = value
    return out


def discover_env_file(explicit: str | None) -> Path | None:
    # Human: Resolve .env — explicit path, cwd, then parents of this script up to repo root.
    # Agent: RETURNS first existing .env path or None.
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


def load_env_from_dotenv(explicit: str | None = None) -> Path | None:
    # Human: Best-effort load of DATABASE_URL / NEBULAR_DATA_DIR from discovered .env.
    # Agent: RETURNS path loaded or None; skips keys already set in the environment.
    path = discover_env_file(explicit)
    if path is None:
        return None
    applied = 0
    for key, value in _parse_env_file(path).items():
        if os.environ.get(key, "").strip():
            continue
        os.environ[key] = value
        applied += 1
    if applied or _parse_env_file(path):
        return path
    return None


def classify_blob(path: Path) -> tuple[str, int]:
    """Human: Return (kind, on_disk_bytes) for one file under NEBULAR_DATA_DIR."""
    size = path.stat().st_size
    if size < 4:
        return ("raw", size)
    with path.open("rb") as f:
        head = f.read(4)
    if head == NOSI_MAGIC:
        return ("nosi", size)
    if head == NOSB_MAGIC:
        return ("nosb", size)
    if head == NOS2_MAGIC:
        return ("nos2", size)
    if head == NOSZ_MAGIC:
        return ("nosz", size)
    return ("raw", size)


def walk_blobs(root: Path) -> dict[str, dict[str, int]]:
    """Human: Aggregate on-disk bytes and file counts by blob kind."""
    totals: dict[str, dict[str, int]] = {
        k: {"files": 0, "bytes": 0} for k in ("nosi", "nosb", "nos2", "nosz", "raw", "total")
    }
    if not root.is_dir():
        return totals
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        kind, nbytes = classify_blob(path)
        totals[kind]["files"] += 1
        totals[kind]["bytes"] += nbytes
        totals["total"]["files"] += 1
        totals["total"]["bytes"] += nbytes
    return totals


def postgres_logical_bytes(database_url: str) -> tuple[int, int]:
    """Human: Sum size_bytes for active files; return (row_count, total_bytes)."""
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*)::bigint, COALESCE(SUM(size_bytes), 0)::bigint "
                "FROM files WHERE deleted_at IS NULL"
            )
            row = cur.fetchone()
            assert row is not None
            return int(row[0]), int(row[1])


def fmt_bytes(n: int) -> str:
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    x = float(n)
    for u in units:
        if x < 1024.0 or u == units[-1]:
            return f"{x:.2f} {u}" if u != "B" else f"{int(x)} B"
        x /= 1024.0
    return f"{n} B"


def parse_cli(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare Postgres logical file bytes to Nebular on-disk blob sizes.",
    )
    parser.add_argument(
        "--env-file",
        metavar="PATH",
        help="load DATABASE_URL and NEBULAR_DATA_DIR from this .env (default: discover repo .env)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    cli = parse_cli(argv)
    explicit_env = (cli.env_file or "").strip() or os.environ.get("STORAGE_AUDIT_ENV_FILE", "").strip() or None
    loaded_env = load_env_from_dotenv(explicit_env)

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        hint = "set DATABASE_URL in the environment or in a repo .env (see .env.example)"
        if loaded_env:
            hint = f"found {loaded_env} but DATABASE_URL is missing or empty — {hint}"
        elif discover_env_file(explicit_env) is None:
            hint = f"no .env found (cwd={Path.cwd()}) — {hint}"
        print(f"DATABASE_URL is required ({hint})", file=sys.stderr)
        return 1

    data_dir = os.environ.get("NEBULAR_DATA_DIR")
    if not data_dir:
        # Human: Compose default mount inside object-storage container maps here on host volume.
        data_dir = "nebular_data/blobs"
        print(
            f"NEBULAR_DATA_DIR not set — using relative {data_dir!r} (set env to your volume path)",
            file=sys.stderr,
        )

    root = Path(data_dir)
    try:
        file_count, logical_bytes = postgres_logical_bytes(database_url)
    except Exception as exc:
        print(f"Postgres query failed: {exc}", file=sys.stderr)
        return 1

    disk = walk_blobs(root)

    print("=== Ownly storage audit ===\n")
    print(f"Postgres files (deleted_at IS NULL): {file_count:,} rows")
    print(f"Logical size_bytes sum:              {fmt_bytes(logical_bytes)} ({logical_bytes:,} B)\n")

    print(f"Nebular blob root: {root.resolve()}\n")
    if not root.is_dir():
        print(f"  (missing — set NEBULAR_DATA_DIR to the Nebular NOS_DATA_DIR blobs path)\n")
    else:
        for kind in ("nosi", "nosb", "nos2", "nosz", "raw"):
            t = disk[kind]
            if t["files"]:
                print(
                    f"  {kind:5}  {t['files']:8,} files  {fmt_bytes(t['bytes']):>12}  ({t['bytes']:,} B on disk)"
                )
        print(
            f"\n  TOTAL {disk['total']['files']:,} blob files  "
            f"{fmt_bytes(disk['total']['bytes'])} on disk"
        )
        delta = disk["total"]["bytes"] - logical_bytes
        print(
            f"\n  On-disk − logical (approx): {fmt_bytes(abs(delta))} "
            f"({'over' if delta >= 0 else 'under'} catalog sum)"
        )
        print(
            "  (Gap is normal: HLS sidecars, compression, legacy formats, orphans, deleted rows.)"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
