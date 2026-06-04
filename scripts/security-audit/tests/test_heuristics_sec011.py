#!/usr/bin/env python3
# Human: Unit tests for SEC-011 zip job detection heuristics.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec011 import zip_access_denied, zip_job_started  # noqa: E402
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec011(unittest.TestCase):
    def test_bulk_job_started(self) -> None:
        res = HttpResult(
            200,
            {},
            "",
            {"job_id": "abc-123", "status": "queued", "progress": 0, "ready": False},
        )
        self.assertTrue(zip_job_started(res))

    def test_folder_job_started(self) -> None:
        res = HttpResult(
            200,
            {},
            "",
            {"status": "queued", "progress": 0, "ready": False, "archive_name": "folder.zip"},
        )
        self.assertTrue(zip_job_started(res))

    def test_access_denied(self) -> None:
        res = HttpResult(400, {}, "", {"error": {"message": "one or more files were not found"}})
        self.assertFalse(zip_job_started(res))
        self.assertTrue(zip_access_denied(res))


if __name__ == "__main__":
    unittest.main()
