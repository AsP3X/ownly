# Human: Identifiers and routes for SEC-012 unauthenticated admin creation exploit.
# Agent: READ by runner/report; maps to security-audit.md SEC-012.

AUDIT_ID = "SEC-012"

DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_SETUP = "/setup"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_AUTH_REGISTER = "/auth/register"
ROUTE_AUTH_ME = "/auth/me"
ROUTE_SETTINGS_REGISTRATION = "/settings/registration"
ROUTE_ADMIN_USERS = "/admin/users"
DEFAULT_ADMIN_PROBE_ROUTE = ROUTE_ADMIN_USERS

# Human: Auto-generated admin email when --created-admin-email / prompt is omitted.
# Agent: READ by runner _created_admin_email; WRITTEN to cache for login verification.
CREATED_ADMIN_EMAIL_FALLBACK_PREFIX = "sec012-created"
CREATED_ADMIN_EMAIL_FALLBACK_DOMAIN = "audit.invalid"

REMEDIATION_SEC012 = (
    "Require SETUP_TOKEN (or equivalent) on POST /setup; restrict setup to private network; "
    "reload users.role from DB in auth_middleware; rotate sessions on role change; "
    "use strong JWT_SECRET from init-env.sh (never defaults in production)."
)

AUDIT_LOG_HINT = (
    "Verify audit_logs for setup.complete / auth.register / admin.users.* — "
    "this script cannot read the database."
)

CASE_LABELS: dict[str, str] = {
    "target_reachable": "API reachable",
    "confirm_exploit_acknowledged": "Live exploit acknowledged (--confirm-exploit)",
    "setup_status_readable": "Setup status readable",
    "exploit_primitive_unauthenticated": "Attack is unauthenticated (no Bearer token)",
    "setup_gate_probe": "Setup mutation gate (invalid probe)",
    "setup_admin_creation": "Live exploit: POST /setup creates administrator",
    "setup_user_role_admin": "Created account has role=admin in auth response",
    "login_as_created_admin": "Login succeeds for created administrator",
    "admin_api_access": "GET /admin/users succeeds with admin session",
    "auth_me_role_admin": "GET /auth/me reports administrator role",
    "initialized_instance_blocked": "Initialized instance rejects second setup (409 or auth gate)",
    "subject_credentials_ready": "Subject account credentials available",
    "subject_session_obtained": "Login or register yields a non-admin session",
    "jwt_secrets_configured": "At least one JWT_SECRET candidate to try",
    "jwt_forgery_escalation": "Forged JWT grants admin API (JWT role not loaded from DB)",
    "admin_user_created_via_api": "POST /admin/users creates new administrator row",
    "created_admin_login": "New administrator can log in with role=admin",
    "register_then_forge_blocked": "Register/login never assigns admin without forgery",
}

EXPLOIT_ANALYSIS_SETUP = (
    "Chain A (setup hijack): While users table is empty, POST /api/v1/setup with attacker "
    "credentials inserts the first user with role=admin and returns a JWT. No bootstrap secret "
    "is required in application code. Impact: full instance takeover."
)

EXPLOIT_ANALYSIS_JWT = (
    "Chain B (initialized instance): Login as non-admin (or register). If only admin credentials "
    "are available, the script creates a temporary pro user via POST /admin/users, then re-signs "
    "that session JWT with role=admin using JWT_SECRET from .env, and POST /admin/users again to "
    "insert the final administrator. require_admin trusts JWT role; auth_middleware does not reload "
    "role from DB."
)
