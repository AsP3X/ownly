# Human: Identifiers and routes for SEC-005 setup bootstrap race audit.
# Agent: CONSTANTS only; imported by runner_sec005 and report_sec005.

AUDIT_ID = "SEC-005"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_SETUP = "/setup"

# Human: Default header probed when checking for bootstrap-token enforcement.
DEFAULT_BOOTSTRAP_HEADER = "X-Setup-Token"

REMEDIATION_SEC005 = (
    "Require SETUP_TOKEN (or similar) on POST /setup; use atomic setup lock; "
    "restrict setup to private network until complete."
)

AUDIT_LOG_HINT = (
    "After remediation, verify only one setup.complete audit and no attacker-owned "
    "admin email from unexpected IPs in audit_logs."
)

CASE_LABELS: dict[str, str] = {
    "target_reachable": "API reachable",
    "setup_status_readable": "Setup status readable",
    "exploit_primitive_unauthenticated": "Attack uses no Authorization header",
    "setup_post_reachable_without_auth": "POST /setup reachable without credentials",
    "bootstrap_token_not_enforced": "Bootstrap secret not required on POST /setup",
    "invalid_bootstrap_token_not_rejected": "Invalid bootstrap header not rejected",
    "setup_public_while_incomplete": "Pre-setup instance accepts unauthenticated setup POST",
    "setup_blocked_after_complete": "POST /setup blocked after setup_complete",
    "concurrent_setup_race": "Concurrent setup race (optional live probe)",
}
