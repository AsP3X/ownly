#!/usr/bin/env python3
# Human: SEC-010 entry point — delegates to scripts/security-audit/lib (standalone).
# Agent: adjusts sys.path; CALLS lib.audit_main_sec010.main; no mediavault imports.

"""
SEC-010 — Setup database test allows unauthenticated internal Postgres probing

See scripts/security-audit/README.md for usage, flags, and exit codes.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lib.audit_main_sec010 import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
