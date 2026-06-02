#!/usr/bin/env python3
# Human: Unit tests for SEC-002 .env file loader.
# Agent: unittest; uses temp files.

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.env_file import apply_env_file, parse_env_file  # noqa: E402


class TestEnvFile(unittest.TestCase):
    def test_parse_sec002_only(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".env", delete=False) as fh:
            fh.write("DATABASE_URL=secret\n")
            fh.write("SEC002_SUBJECT_EMAIL=a@test.com\n")
            fh.write('SEC002_SUBJECT_PASSWORD="pass"\n')
            path = Path(fh.name)
        try:
            parsed = parse_env_file(path)
            self.assertEqual(parsed["SEC002_SUBJECT_EMAIL"], "a@test.com")
            self.assertEqual(parsed["SEC002_SUBJECT_PASSWORD"], "pass")
            self.assertNotIn("DATABASE_URL", parsed)
        finally:
            path.unlink()

    def test_apply_does_not_overwrite(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".env", delete=False) as fh:
            fh.write("SEC002_DEMOTER_EMAIL=new@test.com\n")
            path = Path(fh.name)
        old = os.environ.get("SEC002_DEMOTER_EMAIL")
        os.environ["SEC002_DEMOTER_EMAIL"] = "existing@test.com"
        try:
            apply_env_file(path)
            self.assertEqual(os.environ["SEC002_DEMOTER_EMAIL"], "existing@test.com")
        finally:
            path.unlink()
            if old is None:
                os.environ.pop("SEC002_DEMOTER_EMAIL", None)
            else:
                os.environ["SEC002_DEMOTER_EMAIL"] = old


if __name__ == "__main__":
    unittest.main()
