# Human: Identifiers and routes for SEC-002 stale JWT admin role audit.
# Agent: CONSTANTS only; imported by runner_sec002 and report_sec002.

AUDIT_ID = "SEC-002"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"
DEFAULT_DEMOTE_ROLE = "pro"
DEFAULT_ADMIN_PROBE_ROUTE = "/admin/users"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_ADMIN_USERS = "/admin/users"

REMEDIATION_SEC002 = (
    "Reload role from DB in auth_middleware and revoke sessions when admin is demoted "
    "(user_session epoch / sid invalidation)."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm admin.users.update audit rows exist for demotions and "
    "that demoted users cannot reach /api/v1/admin/* without a fresh login."
)

CASE_LABELS: dict[str, str] = {
    "credentials_configured": "Credentials provided for audit mode",
    "bootstrap_subject_created": "Temporary subject admin created",
    "bootstrap_subject_deleted": "Temporary subject admin removed",
    "target_reachable": "API reachable",
    "setup_complete_required": "Instance reports setup complete",
    "subject_login": "Subject admin can authenticate",
    "subject_is_admin": "Subject account has admin role at login",
    "subject_admin_before_demotion": "Subject JWT grants admin list before demotion",
    "demoter_login": "Demoter admin can authenticate",
    "demoter_is_admin": "Demoter account has admin role at login",
    "demotion_applied": "Demoter demotes subject role in database",
    "stale_jwt_admin_denied": "Stale subject JWT denied on admin route after demotion",
    "admin_role_restored": "Subject admin role restored after probe",
    "exploit_primitive_stale_jwt": "Attack reuses pre-demotion JWT (no re-login)",
}
