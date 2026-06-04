#!/usr/bin/env python3
# Human: SEC-012 entry point — live exploit for unauthenticated first-admin creation.
# Agent: adjusts sys.path; CALLS lib.audit_main_sec012.main; no mediavault imports.

"""
SEC-012 — Administrator creation exploit (setup hijack or initialized-instance JWT chain)

Requires --confirm-exploit.

- Fresh DB (setup_complete=false): POST /setup creates first admin.
- Initialized instance: login as any non-admin, re-sign JWT with role=admin using JWT_SECRET
  from repo .env, POST /admin/users to create a new administrator, verify login.

See scripts/security-audit/README.md and security-audit.md → SEC-012.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lib.audit_main_sec012 import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
