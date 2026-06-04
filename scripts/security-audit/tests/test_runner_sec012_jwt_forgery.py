#!/usr/bin/env python3
# Human: Unit tests for SEC-012 JWT forgery false-positive guards.
# Agent: unittest; no live API.

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.models import AuditReport, CaseResult, HttpResult, Sec012Config
from lib.runner_sec012 import (  # noqa: E402
    _browser_user_creation_blocked,
    _subject_eligible_for_jwt_forgery,
)


class TestSubjectEligibleForJwtForgery(unittest.TestCase):
    def test_rejects_real_admin_subject(self) -> None:
        cache = {"subject_role": "admin", "subject_user_id": "uid-1"}
        self.assertFalse(_subject_eligible_for_jwt_forgery(cache))

    def test_allows_bootstrapped_non_admin(self) -> None:
        cache = {
            "subject_role": "pro",
            "subject_user_id": "uid-2",
            "bootstrapped_via_admin": True,
        }
        self.assertTrue(_subject_eligible_for_jwt_forgery(cache))

    def test_allows_pro_user(self) -> None:
        cache = {"subject_role": "pro", "subject_user_id": "uid-3"}
        self.assertTrue(_subject_eligible_for_jwt_forgery(cache))


class TestBrowserUserCreationBlocked(unittest.TestCase):
    def test_detects_browser_guard_message(self) -> None:
        res = HttpResult(
            403,
            {},
            '{"error":{"code":"forbidden","message":"user accounts can only be created from the web application"}}',
            {"error": {"code": "forbidden", "message": "user accounts can only be created from the web application"}},
        )
        self.assertTrue(_browser_user_creation_blocked(res))

    def test_rejects_other_forbidden(self) -> None:
        res = HttpResult(
            403,
            {},
            '{"error":{"message":"administrator access is required"}}',
            {"error": {"message": "administrator access is required"}},
        )
        self.assertFalse(_browser_user_creation_blocked(res))


if __name__ == "__main__":
    unittest.main()
