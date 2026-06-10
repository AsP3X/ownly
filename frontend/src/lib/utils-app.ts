// Human: Format byte counts for storage usage displays in the drive UI.
// Agent: READS number; RETURNS human-readable string with B/KB/MB/GB.

// Human: Client-side row/session ids must work on HTTP live hosts, not only HTTPS/localhost.
// Agent: USES crypto.randomUUID in secure contexts; FALLBACK time+random when API is missing.
export function createClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// Human: Copy text to the system clipboard from share links and similar UI actions.
// Agent: CALLS navigator.clipboard.writeText when allowed; FALLBACK document.execCommand on plain HTTP hosts.
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available.");
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Agent: Secure-context API may reject on HTTP live deployments — fall through to execCommand.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("execCommand copy failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

// Human: Short label for file table "Opened" column — prefers updated_at when present.
// Agent: READS ISO timestamps; RETURNS locale date string for drive file rows.
export function formatFileOpened(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

// Human: Compact relative label for explorer grid tile metadata — matches Pencil "2m ago" copy.
// Agent: READS ISO updated_at; RETURNS short relative phrase; FALLS BACK to formatFileOpened for older files.
export function formatFileUpdatedRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return formatFileOpened(iso);
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return formatFileOpened(iso);
}

// Human: Derive two-letter avatar initials from an email local-part for the top-bar profile chip.
// Agent: READS email string; RETURNS uppercase initials (e.g. niklas.vorberg@… → NV).
export function userInitials(email?: string | null): string {
  if (!email) return "?";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return local.slice(0, 2).toUpperCase() || "?";
}

// Human: Subtitle under the desktop topbar display name — maps API role to friendly copy.
// Agent: READS role string from auth user; RETURNS label for DriveDesktopTopbar profile row.
export function userRoleLabel(role?: string | null): string {
  if (!role) return "Pro Member";
  if (role === "admin") return "Super Administrator";
  if (role === "user" || role === "member") return "Pro Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Human: Admin directory "Last Active" column — relative time from audit activity timestamps.
// Agent: READS ISO string|null; RETURNS human phrases (Active now, 2m ago, Never).
// Human: Admin panel refresh stamp — short relative phrase from a local Date.
// Agent: READS Date|null from useAdminQuery.lastUpdatedAt; RETURNS empty when null.
export function formatLastRefreshed(at: Date | null): string {
  if (!at) return "";
  const diffMs = Date.now() - at.getTime();
  if (diffMs < 5_000) return "Updated just now";
  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

export function formatRelativeActive(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "Active now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return formatDate(iso);
}

// Human: Map API role id to admin console table label.
// Agent: READS role string; RETURNS display label for pills and role catalog.
export function adminRoleTableLabel(role: string): string {
  if (role === "admin") return "Administrator";
  if (role === "standard") return "Standard User";
  if (role === "pro" || role === "user") return "Pro User";
  return userRoleLabel(role);
}

// Human: Compare stored roles when legacy `user` meant Pro User in the directory.
// Agent: READS API role; RETURNS canonical role id for change detection.
export function normalizeAdminUserRole(role: string): string {
  if (role === "user") return "pro";
  return role;
}

// Human: Friendly name for admin edit-user dialog subtitle (Pencil: "Sarah Jenkins • email").
// Agent: READS email local-part; RETURNS title-cased tokens from . _ - separators.
export function userDisplayName(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return local || email;
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Human: Map API role to edit-dialog segmented tier (Standard / Pro / Administrator). */
export type AdminUserRoleTier = "standard" | "pro" | "admin";

export function adminUserRoleTierFromApi(role: string): AdminUserRoleTier {
  if (role === "admin") return "admin";
  if (role === "standard") return "standard";
  return "pro";
}

export function adminUserRoleTierToApi(tier: AdminUserRoleTier): string {
  return tier;
}

export type FileTypeFilter =
  | "all"
  | "documents"
  | "spreadsheets"
  | "presentations"
  | "images"
  | "video"
  | "audio";

// Human: Client-side mime grouping for the drive filter pills (matches wireframe type chips).
// Agent: READS FileItem.mime_type; RETURNS true when file belongs to the selected filter bucket.
// Human: True when a stored file should open in the image gallery viewer.
// Agent: READS mime_type; RETURNS true for any image/* bucket (PNG, JPEG, SVG, WebP, etc.).
export function isImageMime(mimeType: string | null | undefined): boolean {
  return (mimeType ?? "").toLowerCase().startsWith("image/");
}

// Human: True when a stored file should open in the PDF viewer dialog.
// Agent: READS mime_type; RETURNS true for application/pdf and other */pdf buckets.
export function isPdfMime(mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  return mime === "application/pdf" || mime.endsWith("/pdf");
}

// Human: True when a stored file should open in the in-browser audio player dialog.
// Agent: READS mime_type; RETURNS true for any audio/* bucket.
export function isAudioMime(mimeType: string | null | undefined): boolean {
  return (mimeType ?? "").toLowerCase().startsWith("audio/");
}

const TEXT_CODE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "css",
  "scss",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
  "csv",
  "log",
  "rs",
  "py",
  "sh",
  "sql",
  "env",
  "toml",
  "ini",
  "cfg",
  "conf",
]);

// Human: True when a stored file should open in the text/code editor dialog.
// Agent: READS mime_type + filename extension; RETURNS true for text/* and common code types.
export function isTextCodePreviewMime(
  mimeType: string | null | undefined,
  filename?: string | null,
): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("xml")
  ) {
    return true;
  }

  const extension = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (isSpreadsheetPreviewMime(mimeType, filename)) return false;
  return TEXT_CODE_EXTENSIONS.has(extension);
}

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "xlsb", "ods"]);

// Human: True when a stored file should open in the Excel spreadsheet preview dialog.
// Agent: READS mime_type + filename; RETURNS true for Excel/ODS workbooks (not plain CSV).
export function isSpreadsheetPreviewMime(
  mimeType: string | null | undefined,
  filename?: string | null,
): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  const extension = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (extension === "csv") return false;
  if (SPREADSHEET_EXTENSIONS.has(extension)) return true;
  if (mime.includes("csv")) return false;
  return (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    (mime.includes("sheet") && !mime.includes("word"))
  );
}

// Human: Folder-scoped text/code tabs for the editor dialog — same pattern as image gallery siblings.
// Agent: FILTERS isTextCodePreviewMime + folder_id; SORTS by filename via sortFilesByName.
export function buildTextCodeGallery<
  T extends { id: string; name: string; mime_type: string | null; folder_id: string | null },
>(allFiles: T[], anchor: T): T[] {
  return sortFilesByName(
    allFiles.filter(
      (item) =>
        isTextCodePreviewMime(item.mime_type, item.name) &&
        item.folder_id === anchor.folder_id,
    ),
  );
}

// Human: Derive a short uppercase format label from mime type or file extension for player chips.
// Agent: READS mime_type + name; RETURNS e.g. MP3, FLAC, or M4A.
export function audioFormatLabel(mimeType: string | null | undefined, fileName: string): string {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("mpeg") || mime.includes("mp3")) return "MP3";
  if (mime.includes("flac")) return "FLAC";
  if (mime.includes("wav")) return "WAV";
  if (mime.includes("ogg")) return "OGG";
  if (mime.includes("opus")) return "OPUS";
  if (mime.includes("aac")) return "AAC";
  if (mime.includes("m4a") || mime.includes("mp4")) return "M4A";
  const ext = fileName.split(".").pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : "AUDIO";
}

// Human: Stable name order for drive browser, gallery, and folder listings.
// Agent: READS name; RETURNS localeCompare with numeric:true — matches DB natural_sort_key().
export function sortFilesByName<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  );
}

// Human: All previewable images in the same folder as the clicked file, ordered by filename.
// Agent: FILTERS allFiles by folder_id + image/*; SORTS by name for gallery navigation.
export function buildImageGallery<T extends { id: string; name: string; mime_type: string | null; folder_id: string | null }>(
  allFiles: T[],
  anchor: T,
): T[] {
  return sortFilesByName(
    allFiles.filter(
      (file) => isImageMime(file.mime_type) && file.folder_id === anchor.folder_id,
    ),
  );
}

// Human: All previewable audio files in the same folder as the clicked file, ordered by filename.
// Agent: FILTERS allFiles by folder_id + audio/*; SORTS by name for player queue navigation.
export function buildAudioGallery<T extends { id: string; name: string; mime_type: string | null; folder_id: string | null }>(
  allFiles: T[],
  anchor: T,
): T[] {
  return sortFilesByName(
    allFiles.filter(
      (file) => isAudioMime(file.mime_type) && file.folder_id === anchor.folder_id,
    ),
  );
}

// Human: HLS-ready videos in the same folder as the opened file — ordered for gallery navigation.
// Agent: FILTERS video/* + hls_ready + folder_id; SORTS by name like image/audio galleries.
export function buildVideoGallery<
  T extends {
    id: string;
    name: string;
    mime_type: string | null;
    folder_id: string | null;
    hls_ready: boolean;
  },
>(allFiles: T[], anchor: T): T[] {
  return sortFilesByName(
    allFiles.filter(
      (file) =>
        (file.mime_type?.startsWith("video/") ?? false) &&
        file.hls_ready &&
        file.folder_id === anchor.folder_id,
    ),
  );
}

export function fileMatchesTypeFilter(
  mimeType: string | null | undefined,
  filter: FileTypeFilter,
): boolean {
  if (filter === "all") return true;
  const mime = (mimeType ?? "").toLowerCase();
  switch (filter) {
    case "documents":
      return (
        mime.startsWith("text/") ||
        mime.includes("pdf") ||
        mime.includes("word") ||
        mime.includes("document") ||
        mime.includes("json") ||
        mime.includes("xml")
      );
    case "spreadsheets":
      return mime.includes("sheet") || mime.includes("excel") || mime.includes("csv");
    case "presentations":
      return mime.includes("presentation") || mime.includes("powerpoint");
    case "images":
      return mime.startsWith("image/");
    case "video":
      return mime.startsWith("video/");
    case "audio":
      return mime.startsWith("audio/");
    default:
      return true;
  }
}

export const DOCKER_POSTGRES_DEFAULTS = {
  host: "postgres",
  port: "5432",
  user: "ownly",
  password: "ownly",
  database: "ownly",
};

export type PostgresConnectionFields = typeof DOCKER_POSTGRES_DEFAULTS;

// Human: Placeholder the API uses when redacting DATABASE_URL for the setup wizard (SEC-001).
// Agent: MUST NOT be treated as a real password when parsing setup/database responses.
export const REDACTED_DATABASE_PASSWORD = "***";

export function buildPostgresUrl(fields: PostgresConnectionFields): string {
  const { host, port, user, password, database } = fields;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

// Human: Mask credentials in the read-only connection URL preview on the database setup step.
// Agent: DISPLAYS user:***@host; NEVER echoes the typed password in the wizard UI.
export function redactPostgresUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return url;
    if (!parsed.username) return url;
    const port = parsed.port || "5432";
    const database = parsed.pathname.replace(/^\//, "");
    return `postgres://${parsed.username}:${REDACTED_DATABASE_PASSWORD}@${parsed.hostname}:${port}/${database}`;
  } catch {
    return url;
  }
}

export function parsePostgresUrl(url: string): PostgresConnectionFields | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    const password = decodeURIComponent(parsed.password);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      user: decodeURIComponent(parsed.username),
      // Human: setup/database returns a redacted URL — empty password means "use server config".
      // Agent: IGNORES REDACTED_DATABASE_PASSWORD so test/setup can resolve via API env DATABASE_URL.
      password: password === REDACTED_DATABASE_PASSWORD ? "" : password,
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

export const DEFAULT_POSTGRES_URL = buildPostgresUrl(DOCKER_POSTGRES_DEFAULTS);
