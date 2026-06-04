#!/usr/bin/env python3
# Human: Unit tests for SEC-012 JWT forgery and setup detection helpers.
# Agent: unittest; no HTTP.

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.heuristics_sec012 import (  # noqa: E402
    forge_admin_jwt,
    normalize_created_admin_email,
    setup_blocked_after_init,
    user_role_from_response,
)
from lib.heuristics_sec005 import setup_mutation_succeeded  # noqa: E402
from lib.models import HttpResult  # noqa: E402


class TestHeuristicsSec012(unittest.TestCase):
    def test_forge_jwt_three_segments(self) -> None:
        token = forge_admin_jwt(
            user_id="user-1",
            email="a@b.c",
            jwt_secret="test-secret",
        )
        parts = token.split(".")
        self.assertEqual(len(parts), 3)
        payload = json.loads(
            __import__("base64")
            .urlsafe_b64decode(parts[1] + "==")
            .decode()
        )
        self.assertEqual(payload["role"], "admin")
        self.assertEqual(payload["sub"], "user-1")

    def test_setup_success_nested_auth(self) -> None:
        res = HttpResult(
            200,
            {},
            "",
            {
                "auth": {
                    "token": "tok",
                    "user": {"id": "1", "email": "x@y.z", "role": "admin"},
                }
            },
        )
        self.assertTrue(setup_mutation_succeeded(res))
        self.assertEqual(user_role_from_response(res), "admin")

    def test_setup_blocked_409(self) -> None:
        res = HttpResult(409, {}, "", {"error": {"message": "already"}})
        self.assertTrue(setup_blocked_after_init(res))


class TestNormalizeCreatedAdminEmail(unittest.TestCase):
    def test_username_gets_audit_domain(self) -> None:
        self.assertEqual(
            normalize_created_admin_email("My-Audit-Admin"),
            "my-audit-admin@audit.invalid",
        )

    def test_full_email_preserved(self) -> None:
        self.assertEqual(
            normalize_created_admin_email("Attacker@Corp.Test"),
            "attacker@corp.test",
        )

    def test_empty_returns_empty(self) -> None:
        self.assertEqual(normalize_created_admin_email("   "), "")


if __name__ == "__main__":
    unittest.main()
