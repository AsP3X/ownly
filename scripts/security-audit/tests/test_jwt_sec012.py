#!/usr/bin/env python3
# Human: Unit tests for SEC-012 JWT re-sign helpers.
# Agent: unittest; no HTTP.

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from lib.jwt_sec012 import (  # noqa: E402
    COMPOSE_DEFAULT_JWT_SECRET,
    decode_jwt_payload_unverified,
    jwt_signature_valid,
    match_jwt_secret_for_token,
    reissue_jwt_with_role,
    resolve_jwt_secret_candidates,
    sign_hs256_jwt,
)


class TestJwtSec012(unittest.TestCase):
    def test_reissue_preserves_ver(self) -> None:
        source = sign_hs256_jwt(
            {
                "sub": "u1",
                "email": "a@b.c",
                "role": "user",
                "iat": 100,
                "exp": 9999,
                "ver": 3,
                "sid": "sess-1",
            },
            "secret",
        )
        forged = reissue_jwt_with_role(
            user_id="u1",
            email="a@b.c",
            role="admin",
            jwt_secret="secret",
            source_token=source,
        )
        payload = decode_jwt_payload_unverified(forged)
        self.assertEqual(payload["role"], "admin")
        self.assertEqual(payload["ver"], 3)
        self.assertEqual(payload["sid"], "sess-1")

    def test_compose_default_round_trip(self) -> None:
        token = sign_hs256_jwt(
            {"sub": "u1", "email": "a@b.c", "role": "user", "iat": 1, "exp": 9, "ver": 0},
            COMPOSE_DEFAULT_JWT_SECRET,
        )
        self.assertTrue(jwt_signature_valid(token, COMPOSE_DEFAULT_JWT_SECRET))
        matched = match_jwt_secret_for_token(
            token,
            ["wrong", COMPOSE_DEFAULT_JWT_SECRET],
        )
        self.assertEqual(matched, COMPOSE_DEFAULT_JWT_SECRET)

    def test_resolve_skips_generate_me(self) -> None:
        import os

        old = os.environ.get("JWT_SECRET")
        os.environ["JWT_SECRET"] = "GENERATE_ME"
        try:
            candidates = resolve_jwt_secret_candidates(None, try_dev_defaults=False)
            self.assertNotIn("GENERATE_ME", candidates)
        finally:
            if old is None:
                os.environ.pop("JWT_SECRET", None)
            else:
                os.environ["JWT_SECRET"] = old


if __name__ == "__main__":
    unittest.main()
