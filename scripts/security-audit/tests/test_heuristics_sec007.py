#!/usr/bin/env python3
# Human: Unit tests for SEC-007 share overview detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec007 import (  # noqa: E402
    overview_metadata_leaked,
    overview_requires_password_flag,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec007(unittest.TestCase):
    def test_metadata_leak(self) -> None:
        res = HttpResult(
            200,
            {},
            "",
            {
                "share": {
                    "requires_password": True,
                    "shared_by_email": "owner@example.com",
                    "name": "folder",
                    "total_file_count": 3,
                }
            },
        )
        self.assertTrue(overview_metadata_leaked(res))
        self.assertTrue(overview_requires_password_flag(res))

    def test_denied_not_leak(self) -> None:
        res = HttpResult(403, {}, "", {"error": {"message": "requires password"}})
        self.assertFalse(overview_metadata_leaked(res))


if __name__ == "__main__":
    unittest.main()
