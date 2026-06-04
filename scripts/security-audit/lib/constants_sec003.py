# Human: Identifiers and routes for SEC-003 public share soft-delete audit.
# Agent: CONSTANTS only; imported by runner_sec003 and report_sec003.

AUDIT_ID = "SEC-003"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_PREFIX = "/api/v1"

ROUTE_SETUP_STATUS = "/setup/status"
ROUTE_AUTH_LOGIN = "/auth/login"
ROUTE_FILES = "/files"
ROUTE_FOLDERS = "/folders"
ROUTE_FILES_UPLOAD = "/files/upload"
ROUTE_SHARES = "/shares"
ROUTE_RECYCLE_RESTORE = "/recycle-bin/restore"

ROUTE_PUBLIC_OVERVIEW = "/public/shares/{token}"
ROUTE_PUBLIC_ALL_FILES = "/public/shares/{token}/all-files"
ROUTE_PUBLIC_DOWNLOAD = "/public/shares/{token}/files/{file_id}/download"

REMEDIATION_SEC003 = (
    "Add deleted_at IS NULL to share-scope file/folder queries; return 404 for "
    "trashed items on public share list/download/archive paths."
)

AUDIT_LOG_HINT = (
    "After remediation, confirm shares.create and files.trash audit rows exist for "
    "the probe; verify no download of trashed file_id appears in access logs."
)

CASE_LABELS: dict[str, str] = {
    "credentials_configured": "Owner credentials provided",
    "target_reachable": "API reachable",
    "setup_complete_required": "Instance reports setup complete",
    "owner_login": "Owner can authenticate",
    "fixtures_ready": "Folder share and probe file prepared",
    "public_lists_file_before_delete": "Public all-files lists probe file before trash",
    "soft_delete_applied": "Probe file moved to recycle bin",
    "public_all_files_excludes_deleted": "Public all-files excludes trashed probe file",
    "public_download_blocked_after_delete": "Public download blocked for trashed file",
    "probe_file_restored": "Probe file restored after audit",
    "exploit_primitive_unauthenticated": "Attack uses public share token only (no owner JWT)",
}
