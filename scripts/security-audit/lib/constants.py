# Human: Shared identifiers and routes for SEC-001 and future audit scripts.
# Agent: CONSTANTS only; imported by runner and report modules.

AUDIT_ID = "SEC-001"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_SETUP_DATABASE = "/setup/database"
ROUTE_SETUP_STORAGE = "/setup/storage"
ROUTE_SETUP_DATABASE_TEST = "/setup/database/test"
ROUTE_SETUP_STORAGE_TEST = "/setup/storage/test"

REMEDIATION_SEC001 = (
    "Restrict GET /setup/database and /setup/storage with ensure_not_complete or admin auth; "
    "never return full DATABASE_URL — use driver/host only or a redacted placeholder."
)

AUDIT_LOG_HINT = (
    "After remediation, grep audit_logs and server logs for password material in request/response context."
)

CASE_LABELS: dict[str, str] = {
    "target_reachable": "API reachable",
    "setup_status_readable": "Setup status readable",
    "setup_status_post_setup": "Instance reports setup complete",
    "database_no_credential_disclosure": "Database credentials not exposed",
    "database_no_full_url_disclosure": "No full database_url in response",
    "database_endpoint_blocked_or_removed": "Database endpoint blocked when public",
    "database_response_fixed_shape": "Database response matches fixed/redacted shape",
    "database_response_minimal": "Database response minimal",
    "database_response_safe_or_empty": "Database response safe",
    "database_endpoint_unexpected_status": "Database endpoint status acceptable",
    "storage_no_infrastructure_disclosure": "Storage metadata not exposed",
    "storage_endpoint_blocked_or_removed": "Storage endpoint blocked when public",
    "storage_response_fixed_shape": "Storage response matches fixed/redacted shape",
    "storage_response_minimal": "Storage response minimal",
    "storage_endpoint_unexpected": "Storage endpoint acceptable",
    "post_setup_database_hardened": "After setup: database endpoint hardened",
    "post_setup_storage_hardened": "After setup: storage endpoint hardened",
    "post_setup_database_contract": "After setup: database blocked or safe body",
    "post_setup_storage_contract": "After setup: storage blocked or safe body",
    "setup_database_test_gated": "POST /setup/database/test gated after setup",
    "setup_storage_test_gated": "POST /setup/storage/test gated after setup",
    "bogus_auth_ignored_database": "Bogus Authorization does not bypass database probe",
    "bogus_auth_ignored_storage": "Bogus Authorization does not bypass storage probe",
    "exploit_primitive_unauthenticated": "Attack uses no Authorization header",
    "responses_are_api_json": "Responses are API JSON (not HTML)",
}
