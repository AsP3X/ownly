#!/usr/bin/env python3
# Human: Unit tests for SEC-005 config loading.
# Agent: unittest; READS env via load_config.

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec005 import load_config, parse_cli  # noqa: E402


class TestConfigSec005(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = load_config(parse_cli([]))
        self.assertEqual(cfg.http.audit_id, "SEC-005")
        self.assertEqual(cfg.bootstrap_header, "X-Setup-Token")
        self.assertFalse(cfg.http.require_setup_complete)

    def test_bootstrap_header_override(self) -> None:
        env = os.environ.copy()
        try:
            os.environ["SEC005_BOOTSTRAP_HEADER"] = "X-Bootstrap-Secret"
            cfg = load_config(parse_cli([]))
            self.assertEqual(cfg.bootstrap_header, "X-Bootstrap-Secret")
        finally:
            os.environ.clear()
            os.environ.update(env)


if __name__ == "__main__":
    unittest.main()
