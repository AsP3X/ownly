# Human: Identifiers and routes for SEC-009 share password brute-force audit.
# Agent: CONSTANTS only; imported by runner_sec009 and report_sec009.

AUDIT_ID = "SEC-009"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"
DEFAULT_SHARE_PASSWORD = "sec009-audit-pass"
DEFAULT_WRONG_ATTEMPTS = 12

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_SHARES = "/shares"
ROUTE_SHARE_BY_ID = "/shares/{share_id}"
ROUTE_PUBLIC_CONTENTS = "/public/shares/{token}/contents"

HEADER_SHARE_PASSWORD = "x-share-password"

REMEDIATION_SEC009 = (
    "Add rate limiting on failed share password attempts keyed by share token and "
    "client IP; apply lockout or exponential backoff after N failures."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm repeated wrong x-share-password attempts return 429 "
    "and audit logs capture share password failures without leaking the token."
)

CASE_LABELS: dict[str, str] = {
    "credentials_configured": "Owner credentials provided",
    "target_reachable": "API reachable",
    "setup_complete_required": "Instance reports setup complete",
    "owner_login": "Owner can authenticate",
    "fixtures_ready": "Password-protected folder share prepared",
    "share_password_gate_active": "Wrong password rejected on gated route",
    "correct_password_still_works": "Correct x-share-password grants access",
    "exploit_primitive_guessed_passwords": "Attack sends many wrong x-share-password values",
    "wrong_password_burst_not_throttled": "Failed password attempts not rate-limited",
    "forwarded_for_rotation_not_throttled": "IP rotation does not trigger throttling",
    "share_revoked_after_probe": "Probe share revoked after audit",
}
