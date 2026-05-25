// Human: Helpers for files still undergoing server-side work (e.g. HLS video ingest).
// Agent: READS FileItem HLS fields; USED by drive UI to disable actions and show badges.

import type { FileItem } from "@/api/client";

// Human: True while a video upload is queued or actively transcoding on the server.
// Agent: READS mime_type, hls_ready, hls_encode_status; FALSE when ingest failed or finished.
export function isFileProcessing(file: FileItem): boolean {
  if (!file.mime_type?.startsWith("video/") || file.hls_ready) {
    return false;
  }
  return file.hls_encode_status !== "failed" && file.hls_encode_status !== "cancelled";
}

// Human: Short label for the processing badge in file rows and grid tiles.
// Agent: READS conversion_progress + hls_encode_status; RETURNS user-facing status text.
export function fileProcessingLabel(file: FileItem): string {
  if (file.hls_encode_status === "queued") {
    return "Processing";
  }
  if (file.conversion_progress > 0) {
    return `Processing ${file.conversion_progress}%`;
  }
  return "Processing";
}
