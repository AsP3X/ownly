#!/usr/bin/env python3
# Human: Unit tests for SEC-002 detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec002 import (  # noqa: E402
    find_user_id_by_email,
    response_indicates_admin_forbidden,
    response_indicates_admin_users_list,
)
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec002(unittest.TestCase):
    def test_admin_list_granted(self) -> None:
        res = HttpResult(
            status=200,
            headers={},
            body_text='{"users":[]}',
            body_json={"users": []},
        )
        self.assertTrue(response_indicates_admin_users_list(res))

    def test_admin_forbidden(self) -> None:
        res = HttpResult(status=403, headers={}, body_text="", body_json=None)
        self.assertTrue(response_indicates_admin_forbidden(res))

    def test_find_user_id(self) -> None:
        body = {"users": [{"id": "u1", "email": "a@b.com", "role": "admin"}]}
        self.assertEqual(find_user_id_by_email(body, "a@b.com"), "u1")


if __name__ == "__main__":
    unittest.main()
