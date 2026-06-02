#!/usr/bin/env python3
# Human: Unit tests for SEC-006 config loading.
# Agent: unittest; READS env via load_config.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec006 import load_config, parse_cli  # noqa: E402
from lib.constants_sec006 import DEFAULT_LOGIN_RPM, DEFAULT_REGISTER_RPM  # noqa: E402


class TestConfigSec006(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = load_config(parse_cli([]))
        self.assertEqual(cfg.http.audit_id, "SEC-006")
        self.assertEqual(cfg.login_rpm, DEFAULT_LOGIN_RPM)
        self.assertEqual(cfg.register_rpm, DEFAULT_REGISTER_RPM)
        self.assertTrue(cfg.probe_register)

    def test_skip_register(self) -> None:
        cfg = load_config(parse_cli(["--skip-register"]))
        self.assertFalse(cfg.probe_register)


if __name__ == "__main__":
    unittest.main()
