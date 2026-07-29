// Human: Short human labels for the explorer list "Type" column.
// Agent: PURE mime/extension → label mapping; NO React so it stays trivially testable.

/**
 * Human: Compact type name for a file row, e.g. "PDF", "Image", "Spreadsheet".
 * Agent: PREFERS mime family; FALLS BACK to the uppercased extension, then "File".
 */
export function fileTypeLabel(
  mimeType: string | null | undefined,
  fileName: string,
): string {
  const mime = (mimeType ?? "").toLowerCase();

  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) {
    return "Spreadsheet";
  }
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "Slides";
  if (mime.includes("epub")) return "EPUB";
  if (mime.includes("rtf")) return "Rich text";
  if (mime.includes("word") || mime.includes("opendocument.text")) return "Document";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("compressed")) {
    return "Archive";
  }

  // Human: No usable mime — show the extension so the column is never empty.
  // Agent: READS the last dot segment; IGNORES dotfiles and overly long pseudo-extensions.
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    const extension = fileName.slice(dotIndex + 1);
    if (extension.length <= 6) return extension.toUpperCase();
  }

  if (mime.startsWith("text/")) return "Text";
  return "File";
}
