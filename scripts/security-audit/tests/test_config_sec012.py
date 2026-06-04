#!/usr/bin/env python3
# Human: Unit tests for SEC-012 interactive prompt policy.
# Agent: unittest; patches stdin.isatty only.

from __future__ import annotations

import sys
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec012 import _missing_non_interactive_fields, _should_interactive_prompt  # noqa: E402


class TestConfigSec012Prompt(unittest.TestCase):
    def test_interactive_on_tty(self) -> None:
        cli = Namespace(prompt=False, quiet=False)
        with patch.object(sys.stdin, "isatty", return_value=True):
            self.assertTrue(
                _should_interactive_prompt(cli, no_prompt=False, output_format="human")
            )

    def test_no_interactive_when_no_prompt(self) -> None:
        cli = Namespace(prompt=False, quiet=False)
        with patch.object(sys.stdin, "isatty", return_value=True):
            self.assertFalse(
                _should_interactive_prompt(cli, no_prompt=True, output_format="human")
            )

    def test_missing_fields_for_ci(self) -> None:
        cli = Namespace(base_url="", jwt_secret="")
        missing = _missing_non_interactive_fields(
            cli=cli,
            base_url="http://127.0.0.1:8080",
            confirm_exploit=False,
            exploit_email="",
            exploit_password="",
            jwt_secrets=(),
        )
        self.assertIn("exploit confirmation (--confirm-exploit or SEC012_CONFIRM_EXPLOIT=1)", missing)
        self.assertIn("subject email (--exploit-email or SEC012_EXPLOIT_EMAIL)", missing)


if __name__ == "__main__":
    unittest.main()
