#!/usr/bin/env python3
# Human: Unit tests for SEC-009 config loading.
# Agent: unittest; READS env via load_config.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec009 import load_config, parse_cli  # noqa: E402
from lib.constants_sec009 import DEFAULT_WRONG_ATTEMPTS  # noqa: E402


class TestConfigSec009(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = load_config(parse_cli([]))
        self.assertEqual(cfg.http.audit_id, "SEC-009")
        self.assertEqual(cfg.wrong_attempts, DEFAULT_WRONG_ATTEMPTS)
        self.assertTrue(cfg.bootstrap_fixtures)


if __name__ == "__main__":
    unittest.main()
