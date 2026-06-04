#!/usr/bin/env python3
# Human: Unit tests for SEC-003 detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec003 import (  # noqa: E402
    extract_share_requires_password,
    public_access_blocked_detail,
    public_access_denied,
    public_all_files_contains_id,
    public_download_grants_file,
    public_overview_requires_password,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec003(unittest.TestCase):
    def test_file_listed(self) -> None:
        res = HttpResult(
            status=200,
            headers={},
            body_text="",
            body_json={"files": [{"id": "f1", "name": "a.txt"}]},
        )
        self.assertTrue(public_all_files_contains_id(res, "f1"))
        self.assertFalse(public_all_files_contains_id(res, "f2"))

    def test_download_granted(self) -> None:
        res = HttpResult(
            status=200,
            headers={"content-disposition": 'attachment; filename="a.txt"'},
            body_text="data",
            body_json=None,
        )
        self.assertTrue(public_download_grants_file(res))

    def test_access_denied(self) -> None:
        self.assertTrue(public_access_denied(HttpResult(404, {}, "", None)))

    def test_share_requires_password(self) -> None:
        res = HttpResult(
            201,
            {},
            "",
            {"share": {"token": "abc", "requires_password": True}},
        )
        self.assertTrue(extract_share_requires_password(res))
        self.assertTrue(
            public_overview_requires_password(
                HttpResult(200, {}, "", {"share": {"requires_password": True}})
            )
        )

    def test_password_403_hint(self) -> None:
        res = HttpResult(
            403,
            {},
            "",
            {"error": {"message": "this link requires a password", "code": "forbidden"}},
        )
        detail = public_access_blocked_detail(res, share_password_configured=False)
        self.assertIn("SEC003_SHARE_PASSWORD", detail)


if __name__ == "__main__":
    unittest.main()
