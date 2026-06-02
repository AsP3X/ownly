# Human: Identifiers and routes for SEC-006 spoofable rate-limit header audit.
# Agent: CONSTANTS only; imported by runner_sec006 and report_sec006.

AUDIT_ID = "SEC-006"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

# Human: Default matches backend config.rs auth_login_rpm / auth_register_rpm.
DEFAULT_LOGIN_RPM = 15
DEFAULT_REGISTER_RPM = 5

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_AUTH_REGISTER = "/auth/register"

HEADER_FORWARDED_FOR = "X-Forwarded-For"
HEADER_REAL_IP = "X-Real-IP"

REMEDIATION_SEC006 = (
    "Rate-limit on connection peer IP unless behind a trusted proxy; "
    "do not trust client-supplied X-Forwarded-For / X-Real-IP without proxy validation."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm auth.login rate limits cluster by real client IP "
    "even when attackers rotate forwarding headers."
)

CASE_LABELS: dict[str, str] = {
    "target_reachable": "API reachable",
    "setup_complete_required": "Instance reports setup complete",
    "exploit_primitive_spoofed_ip_headers": "Attack rotates X-Forwarded-For / X-Real-IP",
    "login_rate_limit_enforced_single_ip": "Login throttled when forwarding IP is fixed",
    "login_bypass_via_forwarded_for_rotation": "Login limit bypassed by X-Forwarded-For rotation",
    "login_bypass_via_x_real_ip_rotation": "Login limit bypassed by X-Real-IP rotation",
    "register_rate_limit_enforced_single_ip": "Register throttled when forwarding IP is fixed",
    "register_bypass_via_forwarded_for_rotation": "Register limit bypassed by X-Forwarded-For rotation",
}
