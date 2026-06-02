#!/usr/bin/env python3
# Human: Compare Ownly Postgres logical bytes to Nebular on-disk blob sizes (ops / tuning).
# Agent: READS DATABASE_URL + NEBULAR_DATA_DIR; SUM files.size_bytes; WALKS blob tree; CLASSIFIES NOS2/NOSZ/NOSD/raw.

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import psycopg
except ImportError:
    print(
        "storage-audit: install psycopg (e.g. pip install 'psycopg[binary]') or run from an env that has it",
        file=sys.stderr,
    )
    sys.exit(2)

NOSZ_MAGIC = b"NOSZ"
NOS2_MAGIC = b"NOS2"
NOSD_MAGIC = b"NOSD"


def classify_blob(path: Path) -> tuple[str, int]:
    """Human: Return (kind, on_disk_bytes) for one file under NEBULAR_DATA_DIR."""
    size = path.stat().st_size
    if size < 4:
        return ("raw", size)
    with path.open("rb") as f:
        head = f.read(4)
    if head == NOS2_MAGIC:
        return ("nos2", size)
    if head == NOSZ_MAGIC:
        return ("nosz", size)
    if head == NOSD_MAGIC:
        return ("nosd", size)
    return ("raw", size)


def walk_blobs(root: Path) -> dict[str, dict[str, int]]:
    """Human: Aggregate on-disk bytes and file counts by blob kind."""
    totals: dict[str, dict[str, int]] = {
        k: {"files": 0, "bytes": 0} for k in ("nos2", "nosz", "nosd", "raw", "total")
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


def main() -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
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
        for kind in ("nos2", "nosz", "nosd", "raw"):
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
            "  (Gap is normal: HLS sidecars, compression, dedup manifests, orphans, deleted rows.)"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
