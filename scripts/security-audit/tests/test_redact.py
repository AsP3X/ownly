#!/usr/bin/env python3
# Human: Unit tests for audit output redaction (no live API).
# Agent: unittest; imports lib.redact from parent package path.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.redact import looks_redacted, redact_sensitive_text  # noqa: E402


class TestRedact(unittest.TestCase):
    def test_masks_postgres_url(self) -> None:
        raw = "postgres://mediavault:secret@postgres:5432/db"
        out = redact_sensitive_text(raw)
        self.assertIn("***", out)
        self.assertNotIn("secret", out)

    def test_looks_redacted_marker(self) -> None:
        self.assertTrue(looks_redacted("postgres://u:***@h/db"))
        self.assertFalse(looks_redacted("postgres://u:secret@h/db"))

    def test_json_secret_key(self) -> None:
        raw = '{"password": "hunter2"}'
        out = redact_sensitive_text(raw)
        self.assertIn("***", out)
        self.assertNotIn("hunter2", out)


if __name__ == "__main__":
    unittest.main()
