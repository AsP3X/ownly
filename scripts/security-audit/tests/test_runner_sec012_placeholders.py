#!/usr/bin/env python3
# Human: Unit tests for SEC-012 placeholder email detection.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.runner_sec012 import _looks_like_placeholder_email  # noqa: E402


class TestPlaceholderEmail(unittest.TestCase):
    def test_detects_readme_example(self) -> None:
        self.assertTrue(_looks_like_placeholder_email("your-existing-user@example.com"))

    def test_real_email_ok(self) -> None:
        self.assertFalse(_looks_like_placeholder_email("niklas@home.local"))


if __name__ == "__main__":
    unittest.main()
