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
