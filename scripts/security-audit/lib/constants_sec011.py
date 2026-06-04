# Human: Identifiers and routes for SEC-011 trash zip archive audit.
# Agent: CONSTANTS only; imported by runner_sec011 and report_sec011.

AUDIT_ID = "SEC-011"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_FILES = "/files"
ROUTE_FILES_UPLOAD = "/files/upload"
ROUTE_FILES_BULK_DOWNLOAD = "/files/download"
ROUTE_FOLDERS = "/folders"
ROUTE_RECYCLE_RESTORE = "/recycle-bin/restore"

REMEDIATION_SEC011 = (
    "Add deleted_at IS NULL to collect_zip_entries_for_folder and "
    "collect_zip_entries_for_file_ids (reuse ACTIVE_FILES_SQL from recycle_bin.rs)."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm bulk and folder zip jobs reject trashed file_ids "
    "and exclude soft-deleted members from folder archives."
)

CASE_LABELS: dict[str, str] = {
    "credentials_configured": "Owner credentials provided",
    "target_reachable": "API reachable",
    "setup_complete_required": "Instance reports setup complete",
    "owner_login": "Owner can authenticate",
    "probe_fixtures_ready": "Probe folder and file uploaded or configured",
    "bulk_zip_works_before_trash": "POST /files/download accepts probe file before trash",
    "folder_zip_works_before_trash": "POST /folders/{id}/download works before trash",
    "soft_delete_applied": "Probe file moved to recycle bin",
    "bulk_zip_blocked_after_trash": "Bulk zip denied for trashed file",
    "folder_zip_blocked_after_trash": "Folder zip denied or empty after trash",
    "probe_file_restored": "Probe file restored after audit",
    "exploit_primitive_authenticated": "Attack uses owner JWT on zip download routes",
}
