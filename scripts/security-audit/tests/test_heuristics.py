#!/usr/bin/env python3
# Human: Unit tests for SEC-001 detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics import (  # noqa: E402
    body_contains_credential_material,
    database_response_is_fixed,
    is_blocked_status,
    storage_exposed_keys,
)


class TestHeuristics(unittest.TestCase):
    def test_blocked_status(self) -> None:
        self.assertTrue(is_blocked_status(404))
        self.assertFalse(is_blocked_status(200))

    def test_credential_in_body(self) -> None:
        body = '{"database_url":"postgres://a:b@h/d"}'
        findings = body_contains_credential_material(body)
        self.assertTrue(len(findings) > 0)

    def test_fixed_database_driver_only(self) -> None:
        self.assertTrue(database_response_is_fixed({"driver": "postgres"}, "{}"))

    def test_storage_exposed(self) -> None:
        keys = storage_exposed_keys({"object_storage_bucket": "media"})
        self.assertIn("object_storage_bucket", keys)


if __name__ == "__main__":
    unittest.main()
