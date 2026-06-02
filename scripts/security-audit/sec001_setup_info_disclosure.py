#!/usr/bin/env python3
# Human: SEC-001 entry point — delegates to scripts/security-audit/lib (standalone).
# Agent: adjusts sys.path; CALLS lib.audit_main.main; no mediavault imports.

"""
SEC-001 — Public setup endpoints leak database credentials and infrastructure metadata

See scripts/security-audit/README.md for usage, flags, and exit codes.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lib.audit_main import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
