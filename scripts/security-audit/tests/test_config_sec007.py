#!/usr/bin/env python3
# Human: Unit tests for SEC-007 config loading.
# Agent: unittest; READS env via load_config.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec007 import load_config, parse_cli  # noqa: E402
from lib.constants_sec007 import DEFAULT_SHARE_PASSWORD  # noqa: E402


class TestConfigSec007(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = load_config(parse_cli([]))
        self.assertEqual(cfg.http.audit_id, "SEC-007")
        self.assertEqual(cfg.share_password, DEFAULT_SHARE_PASSWORD)
        self.assertTrue(cfg.bootstrap_fixtures)
        self.assertTrue(cfg.revoke_after_probe)


if __name__ == "__main__":
    unittest.main()
