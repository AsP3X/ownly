#!/usr/bin/env python3
# Human: Unit tests for baseline compare helper.
# Agent: tempfile JSON round-trip.

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.compare import compare_to_baseline, save_baseline  # noqa: E402
from lib.models import AuditReport, CaseResult  # noqa: E402


class TestCompare(unittest.TestCase):
    def test_baseline_roundtrip(self) -> None:
        report = AuditReport(
            audit_id="SEC-001",
            target="http://test/api/v1",
            verdict="ok",
            exit_code=0,
            setup_complete=True,
            results=[
                CaseResult("target_reachable", True, "ok", "pass"),
            ],
        )
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            path = tmp.name
        try:
            save_baseline(path, report)
            ok, _msg = compare_to_baseline(report, path)
            self.assertTrue(ok)
        finally:
            Path(path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
