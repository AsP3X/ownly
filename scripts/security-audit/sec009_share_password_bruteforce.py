#!/usr/bin/env python3
# Human: SEC-009 entry point — delegates to scripts/security-audit/lib (standalone).
# Agent: adjusts sys.path; CALLS lib.audit_main_sec009.main; no mediavault imports.

"""
SEC-009 — Public share password checks lack brute-force throttling

See scripts/security-audit/README.md for usage, flags, and exit codes.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lib.audit_main_sec009 import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
