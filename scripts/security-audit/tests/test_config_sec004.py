#!/usr/bin/env python3
# Human: Unit tests for SEC-004 credential requirements.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec004 import missing_credential_fields  # noqa: E402
from lib.constants_sec004 import AUDIT_ID
from lib.models import Config, Sec004Config  # noqa: E402


def _cfg(**kwargs) -> Sec004Config:
    http = Config(
        audit_id=AUDIT_ID,
        base_url="http://127.0.0.1:8080",
        api_prefix="/api/v1",
        timeout_sec=15.0,
        insecure_tls=False,
        require_setup_complete=True,
        verbose=False,
        show_leaks=True,
        redact_output=True,
        output_format="human",
        quiet=False,
        compact=False,
        strict_heuristics=False,
        retries=0,
        fail_fast=False,
        output_file=None,
        compare_baseline=None,
        save_baseline=None,
    )
    defaults = dict(
        http=http,
        owner_email="",
        owner_password="",
        file_id="",
        bootstrap_fixtures=True,
        restore_after_probe=True,
    )
    defaults.update(kwargs)
    return Sec004Config(**defaults)


class TestConfigSec004(unittest.TestCase):
    def test_missing(self) -> None:
        self.assertEqual(len(missing_credential_fields(_cfg())), 2)

    def test_ok(self) -> None:
        self.assertEqual(
            missing_credential_fields(_cfg(owner_email="a@b.com", owner_password="x")),
            [],
        )


if __name__ == "__main__":
    unittest.main()
