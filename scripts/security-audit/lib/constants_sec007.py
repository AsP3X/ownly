# Human: Identifiers and routes for SEC-007 password-protected share overview audit.
# Agent: CONSTANTS only; imported by runner_sec007 and report_sec007.

AUDIT_ID = "SEC-007"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"
DEFAULT_SHARE_PASSWORD = "sec007-audit-pass"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_SHARES = "/shares"
ROUTE_SHARE_BY_ID = "/shares/{share_id}"

ROUTE_PUBLIC_OVERVIEW = "/public/shares/{token}"
ROUTE_PUBLIC_CONTENTS = "/public/shares/{token}/contents"

REMEDIATION_SEC007 = (
    "Route GET /public/shares/{token} through resolve_public_share (password check) "
    "like other public share endpoints; add integration tests for overview."
)

AUDIT_LOG_HINT = (
    "After remediation, verify overview without x-share-password returns 403 for "
    "password-protected tokens while contents/all-files remain gated consistently."
)

CASE_LABELS: dict[str, str] = {
    "credentials_configured": "Owner credentials provided",
    "target_reachable": "API reachable",
    "setup_complete_required": "Instance reports setup complete",
    "owner_login": "Owner can authenticate",
    "fixtures_ready": "Password-protected folder share prepared",
    "share_password_enabled": "Share requires password (owner PATCH)",
    "exploit_primitive_unauthenticated": "Attack uses share token only (no password header)",
    "overview_blocked_without_password": "Overview denied without x-share-password",
    "overview_leaks_metadata_without_password": "Overview exposes metadata without password",
    "contents_blocked_without_password": "Contents endpoint still requires password",
    "overview_works_with_password": "Overview succeeds with correct x-share-password",
}
