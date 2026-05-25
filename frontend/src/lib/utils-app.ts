// Human: Format byte counts for storage usage displays in the drive UI.
// Agent: READS number; RETURNS human-readable string with B/KB/MB/GB.

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

// Human: Stable name order for gallery prev/next — matches folder listing sort (1, 2, 10…).
// Agent: READS FileItem.name; RETURNS new array sorted with localeCompare + numeric.
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
  user: "mediavault",
  password: "mediavault",
  database: "mediavault",
};

export type PostgresConnectionFields = typeof DOCKER_POSTGRES_DEFAULTS;

export function buildPostgresUrl(fields: PostgresConnectionFields): string {
  const { host, port, user, password, database } = fields;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function parsePostgresUrl(url: string): PostgresConnectionFields | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

export const DEFAULT_POSTGRES_URL = buildPostgresUrl(DOCKER_POSTGRES_DEFAULTS);
