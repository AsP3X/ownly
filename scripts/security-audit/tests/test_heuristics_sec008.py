#!/usr/bin/env python3
# Human: Unit tests for SEC-008 storage probe detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec008 import (  # noqa: E402
    private_address_rejected,
    ssrf_probe_vulnerable,
    storage_test_setup_complete_block,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec008(unittest.TestCase):
    def test_private_rejected(self) -> None:
        res = HttpResult(
            400,
            {},
            "",
            {"error": {"message": "private addresses are not allowed"}},
        )
        self.assertTrue(private_address_rejected(res))
        self.assertFalse(ssrf_probe_vulnerable(res))

    def test_reach_failure_vulnerable(self) -> None:
        res = HttpResult(
            400,
            {},
            "",
            {"error": {"message": "could not reach object storage; check the endpoint URL"}},
        )
        self.assertTrue(ssrf_probe_vulnerable(res))

    def test_setup_complete(self) -> None:
        res = HttpResult(409, {}, "", {"error": {"message": "setup already completed"}})
        self.assertTrue(storage_test_setup_complete_block(res))


if __name__ == "__main__":
    unittest.main()
