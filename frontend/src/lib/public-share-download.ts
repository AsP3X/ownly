// Human: Zip and single-file download helpers for anonymous public share visitors.
// Agent: CALLS startPublicShareDownloadArchive + poll; FETCHES archive without JWT.

import type { FileItem } from "@/api/client";
import {
  ApiError,
  downloadPublicShareFile,
  fetchPublicShareDownloadArchiveStatus,
  publicShareDownloadArchiveUrl,
  startPublicShareDownloadArchive,
} from "@/api/client";
// Human: Trigger a browser save-as for a blob (same pattern as authenticated downloads).
// Agent: CREATES object URL; CLICKS temporary anchor; REVOKES URL.
function saveBlobAsFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const PUBLIC_ZIP_POLL_MS = 800;

export type PublicShareDownloadProgress = {
  phase: "processing" | "saving";
  percent: number;
  indeterminate: boolean;
  archiveName?: string;
};

// Human: Download one or many shared files — single file direct, multiple as zip archive.
// Agent: POST public download-archive; POLLS job; saveBlobAsFile on completion.
export async function downloadPublicShareFiles(
  token: string,
  files: FileItem[],
  sharePassword: string | null,
  onProgress?: (update: PublicShareDownloadProgress) => void,
): Promise<void> {
  if (files.length === 0) return;

  if (files.length === 1) {
    const only = files[0]!;
    onProgress?.({ phase: "saving", percent: 50, indeterminate: false });
    await downloadPublicShareFile(token, only.id, only.name, sharePassword);
    onProgress?.({ phase: "saving", percent: 100, indeterminate: false });
    return;
  }

  const started = await startPublicShareDownloadArchive(
    token,
    files.map((f) => f.id),
    sharePassword,
  );

  if (started.single_file_id) {
    const match = files.find((f) => f.id === started.single_file_id) ?? files[0]!;
    await downloadPublicShareFile(token, match.id, match.name, sharePassword);
    return;
  }

  if (!started.job_id) {
    throw new ApiError("Download could not be started", "download_failed", 500);
  }

  let archiveName = started.archive_name || "shared-files.zip";

  for (;;) {
    const status = await fetchPublicShareDownloadArchiveStatus(
      token,
      started.job_id,
      sharePassword,
    );
    archiveName = status.archive_name || archiveName;

    if (status.status === "failed") {
      throw new ApiError(status.error ?? "Archive failed", "public_zip_failed", 500);
    }

    const indeterminate =
      (status.status === "queued" || status.status === "compressing") && status.progress <= 0;
    onProgress?.({
      phase: "processing",
      percent: Math.min(99, status.progress),
      indeterminate,
      archiveName,
    });

    if (status.ready) {
      onProgress?.({ phase: "processing", percent: 100, indeterminate: false });
      break;
    }

    await new Promise((resolve) => window.setTimeout(resolve, PUBLIC_ZIP_POLL_MS));
  }

  onProgress?.({ phase: "saving", percent: 90, indeterminate: false });
  const response = await fetch(publicShareDownloadArchiveUrl(token, started.job_id), {
    cache: "no-store",
    headers: sharePassword ? { "X-Share-Password": sharePassword } : undefined,
  });
  if (!response.ok) {
    throw new ApiError("Could not download archive", "download_failed", response.status);
  }
  const blob = await response.blob();
  saveBlobAsFile(blob, archiveName);
  onProgress?.({ phase: "saving", percent: 100, indeterminate: false });
}
