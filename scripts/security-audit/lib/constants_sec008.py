# Human: Identifiers and routes for SEC-008 setup storage SSRF audit.
# Agent: CONSTANTS only; imported by runner_sec008 and report_sec008.

AUDIT_ID = "SEC-008"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_SETUP_STORAGE_TEST = "/setup/storage/test"

# Human: Internal probe URLs — RFC5737 + metadata + RFC1918 (safe recon targets).
DEFAULT_PROBE_TARGETS: tuple[tuple[str, str], ...] = (
    ("localhost", "http://127.0.0.1:1"),
    ("link_local_metadata", "http://169.254.169.254"),
    ("private_rfc1918", "http://10.0.0.1:1"),
)

REMEDIATION_SEC008 = (
    "Require bootstrap auth on POST /setup/storage/test; block private/link-local "
    "and metadata IPs before outbound storage health probes."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm setup storage test rejects 127.0.0.0/8 and "
    "169.254.169.254 without server-side fetch, and is gated after setup completes."
)

CASE_LABELS: dict[str, str] = {
    "target_reachable": "API reachable",
    "setup_status_readable": "Setup status readable",
    "exploit_primitive_unauthenticated": "Attack uses no Authorization header",
    "pre_setup_required_for_ssrf_probe": "Instance must be pre-setup to test SSRF",
    "storage_test_public_pre_setup": "POST /setup/storage/test reachable before setup",
    "internal_targets_not_blocked": "Internal/metadata storage URLs not rejected",
    "post_setup_storage_test_gated": "POST /setup/storage/test blocked after setup",
}
