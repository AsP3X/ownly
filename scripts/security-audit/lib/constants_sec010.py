# Human: Identifiers and routes for SEC-010 setup database SSRF audit.
# Agent: CONSTANTS only; imported by runner_sec010 and report_sec010.

AUDIT_ID = "SEC-010"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_SETUP_DATABASE_TEST = "/setup/database/test"

# Human: Internal Postgres URLs — safe recon targets (invalid creds, unreachable ports).
DEFAULT_PROBE_TARGETS: tuple[tuple[str, str], ...] = (
    ("localhost", "postgres://sec010probe:sec010probe@127.0.0.1:5432/sec010probe"),
    ("private_rfc1918", "postgres://sec010probe:sec010probe@10.0.0.1:5432/sec010probe"),
)

REMEDIATION_SEC010 = (
    "Require bootstrap auth on POST /setup/database/test; reject localhost/private "
    "Postgres hosts before outbound connect; prefer lightweight TCP check over init_pool."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm setup database test rejects 127.0.0.0/8 and RFC1918 "
    "targets without server-side Postgres connect, and is gated after setup completes."
)

CASE_LABELS: dict[str, str] = {
    "target_reachable": "API reachable",
    "setup_status_readable": "Setup status readable",
    "exploit_primitive_unauthenticated": "Attack uses no Authorization header",
    "pre_setup_required_for_db_probe": "Instance must be pre-setup to test DB probe",
    "database_test_public_pre_setup": "POST /setup/database/test reachable before setup",
    "internal_targets_not_blocked": "Internal/private database URLs not rejected",
    "post_setup_database_test_gated": "POST /setup/database/test blocked after setup",
}
