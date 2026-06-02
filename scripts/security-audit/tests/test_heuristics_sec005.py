#!/usr/bin/env python3
# Human: Unit tests for SEC-005 detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec005 import (  # noqa: E402
    bootstrap_token_enforced,
    invalid_probe_processed_without_auth,
    responses_same_auth_outcome,
    setup_mutation_succeeded,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec005(unittest.TestCase):
    def test_bootstrap_401(self) -> None:
        res = HttpResult(
            401,
            {},
            '{"error":{"code":"unauthorized","message":"missing setup token"}}',
            {"error": {"message": "missing setup token"}},
        )
        self.assertTrue(bootstrap_token_enforced(res))

    def test_no_bootstrap_409(self) -> None:
        res = HttpResult(409, {}, "", {"error": {"message": "setup already completed"}})
        self.assertFalse(bootstrap_token_enforced(res))
        self.assertTrue(invalid_probe_processed_without_auth(res))

    def test_setup_success(self) -> None:
        res = HttpResult(
            200,
            {},
            "",
            {"auth": {"token": "jwt-here", "user": {"id": "1", "email": "a@b.c"}}},
        )
        self.assertTrue(setup_mutation_succeeded(res))

    def test_same_outcome(self) -> None:
        a = HttpResult(409, {}, "", None)
        b = HttpResult(409, {}, "", None)
        self.assertTrue(responses_same_auth_outcome(a, b))


if __name__ == "__main__":
    unittest.main()
