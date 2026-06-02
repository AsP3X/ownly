# Human: Detection helpers for SEC-005 unauthenticated setup bootstrap.
# Agent: READS HttpResult; no HTTP; used by runner and unit tests.

from __future__ import annotations

import re

from .heuristics import json_get
from .models import HttpResult

__all__ = [
    "bootstrap_token_enforced",
    "invalid_probe_processed_without_auth",
    "responses_same_auth_outcome",
    "setup_mutation_succeeded",
]

_TOKEN_HINT = re.compile(
    r"setup[\s_-]*token|bootstrap[\s_-]*token|bootstrap[\s_-]*secret",
    re.IGNORECASE,
)


def _error_message(res: HttpResult) -> str:
    if res.body_json is None or not isinstance(res.body_json, dict):
        return res.body_text
    err = res.body_json.get("error")
    if isinstance(err, dict):
        msg = err.get("message")
        if isinstance(msg, str):
            return msg
    return res.body_text


def bootstrap_token_enforced(res: HttpResult) -> bool:
    # Human: True when API rejects setup without a valid bootstrap credential.
    # Agent: CHECKS HTTP 401/403; optional body hint for token/bootstrap wording.
    if res.status not in (401, 403):
        return False
    text = _error_message(res)
    if _TOKEN_HINT.search(text):
        return True
    # Human: 401/403 on setup POST without matching body still counts as gated.
    return True


def invalid_probe_processed_without_auth(res: HttpResult) -> bool:
    # Human: Server applied setup handler logic without an auth/bootstrap gate first.
    # Agent: RETURNS True for 400 validation, 409 already-complete, or 200 success.
    if res.status == 200:
        return True
    if res.status == 400:
        return True
    if res.status == 409:
        return True
    return False


def setup_mutation_succeeded(res: HttpResult) -> bool:
    # Human: Attacker could complete setup (JWT issued).
    # Agent: CHECKS HTTP 200/201 and auth.token in JSON — critical signal.
    if res.status not in (200, 201) or res.body_json is None:
        return False
    if not isinstance(res.body_json, dict):
        return False
    token = json_get(res.body_json, "token")
    if token is None and isinstance(res.body_json.get("auth"), dict):
        token = json_get(res.body_json["auth"], "token")
    return isinstance(token, str) and bool(token.strip())


def responses_same_auth_outcome(a: HttpResult, b: HttpResult) -> bool:
    # Human: Bogus bootstrap header did not change auth rejection behavior.
    # Agent: COMPARES status + bootstrap_token_enforced outcome.
    return a.status == b.status and bootstrap_token_enforced(a) == bootstrap_token_enforced(b)
