#!/usr/bin/env python3
# Human: Unit tests for SEC-012 placeholder email detection.
# Agent: unittest; no HTTP.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.constants_sec012 import (
    CREATED_ADMIN_EMAIL_FALLBACK_DOMAIN,
    CREATED_ADMIN_EMAIL_FALLBACK_PREFIX,
)
from lib.models import Config, Sec012Config
from lib.runner_sec012 import _created_admin_email, _looks_like_placeholder_email  # noqa: E402


class TestPlaceholderEmail(unittest.TestCase):
    def test_detects_readme_example(self) -> None:
        self.assertTrue(_looks_like_placeholder_email("your-existing-user@example.com"))

    def test_real_email_ok(self) -> None:
        self.assertFalse(_looks_like_placeholder_email("niklas@home.local"))


def _minimal_sec012_cfg(created_admin_email: str = "") -> Sec012Config:
    http = Config(
        audit_id="SEC-012",
        base_url="http://127.0.0.1:8080",
        api_prefix="/api/v1",
        timeout_sec=10.0,
        insecure_tls=False,
        require_setup_complete=False,
        verbose=False,
        show_leaks=False,
        redact_output=True,
        output_format="human",
        quiet=False,
        compact=False,
        strict_heuristics=False,
        retries=0,
        fail_fast=False,
        output_file=None,
        compare_baseline=None,
        save_baseline=False,
    )
    return Sec012Config(
        http=http,
        confirm_exploit=True,
        exploit_email="pro@example.com",
        exploit_password="password123",
        instance_name="",
        jwt_secrets=(),
        try_jwt_forgery=True,
        try_dev_jwt_defaults=True,
        admin_probe_route="/admin/users",
        created_admin_email=created_admin_email,
        bootstrap_via_admin=True,
        prompt_credentials=False,
        no_prompt=True,
    )


class TestCreatedAdminEmail(unittest.TestCase):
    def test_uses_custom_name_when_set(self) -> None:
        cfg = _minimal_sec012_cfg("attacker@corp.test")
        cache: dict[str, object] = {}
        self.assertEqual(_created_admin_email(cfg, cache), "attacker@corp.test")
        self.assertEqual(cache["created_admin_email"], "attacker@corp.test")

    def test_username_only_gets_audit_domain(self) -> None:
        cfg = _minimal_sec012_cfg("my-staging-admin")
        cache: dict[str, object] = {}
        self.assertEqual(
            _created_admin_email(cfg, cache),
            "my-staging-admin@audit.invalid",
        )

    def test_fallback_schema_when_empty(self) -> None:
        cfg = _minimal_sec012_cfg("")
        cache: dict[str, object] = {}
        email = _created_admin_email(cfg, cache)
        self.assertTrue(
            email.startswith(f"{CREATED_ADMIN_EMAIL_FALLBACK_PREFIX}-")
            and email.endswith(f"@{CREATED_ADMIN_EMAIL_FALLBACK_DOMAIN}")
        )
        self.assertEqual(cache["created_admin_email"], email)


if __name__ == "__main__":
    unittest.main()
