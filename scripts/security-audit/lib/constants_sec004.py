# Human: Identifiers and routes for SEC-004 authenticated trash download audit.
# Agent: CONSTANTS only; imported by runner_sec004 and report_sec004.

AUDIT_ID = "SEC-004"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_FILES = "/files"
ROUTE_FILES_UPLOAD = "/files/upload"
ROUTE_FOLDERS = "/folders"
ROUTE_RECYCLE_RESTORE = "/recycle-bin/restore"

REMEDIATION_SEC004 = (
    "Add deleted_at IS NULL to authenticated download, download-url, preview-url, "
    "and HLS ownership queries (reuse ACTIVE_FILES_SQL from recycle_bin.rs)."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm files.trash audit exists and trashed file_id no longer "
    "appears in download or presigned-url flows."
)

CASE_LABELS: dict[str, str] = {
    "credentials_configured": "Owner credentials provided",
    "target_reachable": "API reachable",
    "setup_complete_required": "Instance reports setup complete",
    "owner_login": "Owner can authenticate",
    "probe_file_ready": "Probe file uploaded or configured",
    "download_works_before_trash": "GET /files/{id}/download works before trash",
    "download_url_works_before_trash": "GET /files/{id}/download-url works before trash",
    "preview_url_works_before_trash": "GET /files/{id}/preview-url works before trash",
    "soft_delete_applied": "Probe file moved to recycle bin",
    "download_blocked_after_trash": "Download denied for trashed file",
    "download_url_blocked_after_trash": "Download-url denied for trashed file",
    "preview_url_blocked_after_trash": "Preview-url denied for trashed file",
    "probe_file_restored": "Probe file restored after audit",
    "exploit_primitive_authenticated": "Attack uses owner JWT on file routes",
}
