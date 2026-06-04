#!/usr/bin/env python3
# Human: Unit tests for SEC-010 config loading.
# Agent: unittest; READS env via load_config.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec010 import load_config, parse_cli  # noqa: E402


class TestConfigSec010(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = load_config(parse_cli([]))
        self.assertEqual(cfg.http.audit_id, "SEC-010")
        self.assertFalse(cfg.require_pre_setup)
        self.assertEqual(len(cfg.probe_targets), 2)


if __name__ == "__main__":
    unittest.main()
