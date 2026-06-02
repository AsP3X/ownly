#!/usr/bin/env python3
# Human: Unit tests for SEC-004 detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec004 import (  # noqa: E402
    authenticated_access_denied,
    authenticated_download_grants_file,
    json_url_issued,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec004(unittest.TestCase):
    def test_json_url(self) -> None:
        res = HttpResult(
            status=200,
            headers={},
            body_text="",
            body_json={"url": "https://example.com/x", "expires_in_seconds": 3600},
        )
        self.assertTrue(json_url_issued(res))

    def test_download_bytes(self) -> None:
        res = HttpResult(
            status=200,
            headers={"content-disposition": "attachment; filename=a.txt"},
            body_text="data",
            body_json=None,
        )
        self.assertTrue(authenticated_download_grants_file(res))

    def test_denied(self) -> None:
        self.assertTrue(authenticated_access_denied(HttpResult(404, {}, "", None)))


if __name__ == "__main__":
    unittest.main()
