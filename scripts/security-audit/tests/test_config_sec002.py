#!/usr/bin/env python3
# Human: Unit tests for SEC-002 credential requirements.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.config_sec002 import missing_credential_fields  # noqa: E402
from lib.constants_sec002 import AUDIT_ID
from lib.models import Config, Sec002Config  # noqa: E402


def _base_cfg(**kwargs) -> Sec002Config:
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
        subject_email="",
        subject_password="",
        demoter_email="",
        demoter_password="",
        demote_role="pro",
        admin_probe_route="/admin/users",
        restore_admin_role=True,
        bootstrap_subject=False,
    )
    defaults.update(kwargs)
    return Sec002Config(**defaults)


class TestConfigSec002(unittest.TestCase):
    def test_requires_four_without_bootstrap(self) -> None:
        missing = missing_credential_fields(_base_cfg())
        self.assertEqual(len(missing), 4)

    def test_bootstrap_only_demoter(self) -> None:
        missing = missing_credential_fields(
            _base_cfg(
                bootstrap_subject=True,
                demoter_email="a@test.com",
                demoter_password="secret",
            )
        )
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
