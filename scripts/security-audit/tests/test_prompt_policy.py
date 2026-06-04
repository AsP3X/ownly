#!/usr/bin/env python3
# Human: Unit tests for interactive credential prompt policy.
# Agent: unittest; patches stdin.isatty only.

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config import should_prompt_missing_credentials  # noqa: E402


class TestPromptPolicy(unittest.TestCase):
    def test_no_prompt_when_credentials_complete(self) -> None:
        self.assertFalse(
            should_prompt_missing_credentials(
                explicit_prompt=False,
                prompt_env_name="SEC002_PROMPT",
                missing=[],
            )
        )

    def test_auto_prompt_on_tty_when_missing(self) -> None:
        with patch.object(sys.stdin, "isatty", return_value=True):
            self.assertTrue(
                should_prompt_missing_credentials(
                    explicit_prompt=False,
                    prompt_env_name="SEC002_PROMPT",
                    missing=["SEC002_DEMOTER_EMAIL"],
                )
            )

    def test_no_auto_prompt_off_tty(self) -> None:
        with patch.object(sys.stdin, "isatty", return_value=False):
            self.assertFalse(
                should_prompt_missing_credentials(
                    explicit_prompt=False,
                    prompt_env_name="SEC002_PROMPT",
                    missing=["SEC002_DEMOTER_EMAIL"],
                )
            )

    def test_explicit_prompt_off_tty(self) -> None:
        with patch.object(sys.stdin, "isatty", return_value=False):
            self.assertTrue(
                should_prompt_missing_credentials(
                    explicit_prompt=True,
                    prompt_env_name="SEC002_PROMPT",
                    missing=["SEC002_DEMOTER_EMAIL"],
                )
            )

    def test_no_prompt_flag_blocks_tty(self) -> None:
        with patch.object(sys.stdin, "isatty", return_value=True):
            self.assertFalse(
                should_prompt_missing_credentials(
                    explicit_prompt=False,
                    prompt_env_name="SEC002_PROMPT",
                    no_prompt=True,
                    no_prompt_env_name="SEC002_NO_PROMPT",
                    missing=["SEC002_DEMOTER_EMAIL"],
                )
            )


if __name__ == "__main__":
    unittest.main()
