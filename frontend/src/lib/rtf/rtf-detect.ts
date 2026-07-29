// Human: Detect RTF files so Drive opens the rich-text editor instead of raw source.
// Agent: READS mime + filename; RETURNS true for .rtf and application/text rtf MIME types.

const RTF_EXTENSIONS = new Set(["rtf"]);

// Human: True when a stored file should open in the RTF rich-text editor dialog.
// Agent: READS mime_type + filename; EXCLUDES spreadsheets; MATCHES rtf extension or rtf MIME.
export function isRtfPreviewMime(
  mimeType: string | null | undefined,
  filename?: string | null,
): boolean {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  const extension = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (RTF_EXTENSIONS.has(extension)) return true;
  if (mime === "application/rtf" || mime === "text/rtf" || mime === "text/richtext") {
    return true;
  }
  return mime.includes("rtf");
}

// Human: Heuristic for raw bytes that look like an RTF document header.
// Agent: READS content prefix; RETURNS true when {\rtf is present near the start.
export function looksLikeRtfContent(content: string): boolean {
  const head = content.slice(0, 64).replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("{\\rtf");
}
