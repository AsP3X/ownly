#!/usr/bin/env python3
# Human: Unit tests for JWT redaction in audit output.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.redact import redact_sensitive_text  # noqa: E402


class TestRedactTokens(unittest.TestCase):
    def test_jwt_redacted(self) -> None:
        token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
        out = redact_sensitive_text(f"Bearer {token}")
        self.assertNotIn(token, out)
        self.assertIn("***", out)


if __name__ == "__main__":
    unittest.main()
