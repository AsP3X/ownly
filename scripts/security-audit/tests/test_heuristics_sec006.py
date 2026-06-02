#!/usr/bin/env python3
# Human: Unit tests for SEC-006 rate-limit detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec006 import (  # noqa: E402
    count_rate_limited,
    header_rotation_bypasses_limit,
    is_rate_limited,
    single_key_enforces_limit,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec006(unittest.TestCase):
    def test_rate_limited_429(self) -> None:
        self.assertTrue(is_rate_limited(HttpResult(429, {}, "", None)))

    def test_rate_limited_json_code(self) -> None:
        res = HttpResult(
            429,
            {},
            "",
            {"error": {"code": "rate_limited", "message": "rate limit exceeded"}},
        )
        self.assertTrue(is_rate_limited(res))

    def test_bypass_detection(self) -> None:
        fixed = [HttpResult(401, {}, "", None)] * 15 + [HttpResult(429, {}, "", None)]
        rotated = [HttpResult(401, {}, "", None)] * 16
        self.assertTrue(single_key_enforces_limit(fixed))
        self.assertTrue(header_rotation_bypasses_limit(fixed, rotated))
        self.assertEqual(count_rate_limited(rotated), 0)


if __name__ == "__main__":
    unittest.main()
