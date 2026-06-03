#!/usr/bin/env python3
# Human: Unit tests for SEC-009 share password brute-force heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec009 import (  # noqa: E402
    brute_force_unthrottled,
    wrong_share_password_rejected,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec009(unittest.TestCase):
    def test_wrong_password_403(self) -> None:
        res = HttpResult(
            403,
            {},
            "",
            {"error": {"message": "incorrect share password"}},
        )
        self.assertTrue(wrong_share_password_rejected(res))

    def test_unthrottled_burst(self) -> None:
        results = [
            HttpResult(403, {}, "", {"error": {"message": "incorrect share password"}})
            for _ in range(10)
        ]
        self.assertTrue(brute_force_unthrottled(results, min_forbidden=8))

    def test_throttled_burst(self) -> None:
        results = [
            HttpResult(403, {}, "", {"error": {"message": "incorrect share password"}})
            for _ in range(5)
        ] + [HttpResult(429, {}, "", {"error": {"code": "rate_limited"}})]
        self.assertFalse(brute_force_unthrottled(results, min_forbidden=8))


if __name__ == "__main__":
    unittest.main()
