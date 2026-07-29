// Human: Shared wording for upload tray status lines, phase labels, and completion summaries.
// Agent: USED by upload-batch-view + UploadTransferPanel so header/body/rows never diverge.

import type { UploadItemSnapshot, UploadPhase } from "@/lib/upload-manager";

export type UploadDisplayCounts = {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  waiting: number;
};

// Human: Single vocabulary for pipeline stages — same strings on every active row.
// Agent: READS phase + mime + isReprocess; RETURNS short label without jargon variants.
export function getUploadPhaseLabel(
  item: Pick<UploadItemSnapshot, "phase" | "isReprocess" | "mimeType">,
): string {
  const isVideo = Boolean(item.mimeType?.startsWith("video/"));
  const isAudio = Boolean(item.mimeType?.startsWith("audio/"));
  const isMedia = isVideo || isAudio;

  if (item.isReprocess) {
    if (item.phase === "storing") return "Saving stream";
    if (item.phase === "encrypting") return "Encrypting stream";
    return "Rebuilding stream";
  }

  switch (item.phase as UploadPhase) {
    case "storing":
      return "Saving";
    case "encrypting":
      return isMedia ? "Encrypting" : "Finalizing";
    case "processing":
      return isMedia ? "Converting" : "Processing";
    case "uploading":
    default:
      return "Uploading";
  }
}

// Human: Right-side numeric / busy label next to the filename.
// Agent: indeterminate post-upload → ellipsis; otherwise "N%".
export function getUploadPercentLabel(item: Pick<UploadItemSnapshot, "phase" | "progress" | "indeterminate">): string {
  const isPostUpload =
    item.phase === "processing" || item.phase === "encrypting" || item.phase === "storing";
  if (isPostUpload && item.indeterminate && item.progress <= 0) {
    return "…";
  }
  return `${Math.min(100, Math.max(0, Math.round(item.progress)))}%`;
}

// Human: Terminal status chip for finished / failed / cancelled rows.
export function getUploadTerminalStatus(status: UploadItemSnapshot["status"]): string {
  if (status === "done") return "Done";
  if (status === "error") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "queued") return "Queued";
  return "Uploading";
}

// Human: Compact header / minimized summary — same phrasing expanded and collapsed.
// Agent: JOINS count fragments with middle dots; complete uses success/partial copy.
export function formatUploadBatchStatusLine(options: {
  counts: UploadDisplayCounts;
  isComplete: boolean;
  isPaused?: boolean;
  etaLabel?: string | null;
  remainingBytesLabel?: string | null;
}): string {
  const { counts, isComplete, isPaused, etaLabel, remainingBytesLabel } = options;

  if (isComplete) {
    if (counts.failed === 0 && counts.cancelled === 0) {
      return counts.total === 1 ? "1 file uploaded" : `All ${counts.total} files uploaded`;
    }
    const parts: string[] = [`${counts.done} uploaded`];
    if (counts.failed > 0) parts.push(`${counts.failed} failed`);
    if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
    return parts.join(" · ");
  }

  if (isPaused) {
    return "Paused · resume to continue";
  }

  const parts: string[] = [];
  if (counts.inFlight > 0) {
    parts.push(`${counts.inFlight} active`);
  }
  if (counts.waiting > 0) {
    parts.push(`${counts.waiting} queued`);
  }
  if (etaLabel) parts.push(etaLabel);
  if (remainingBytesLabel) parts.push(remainingBytesLabel);
  if (parts.length === 0) {
    return "Preparing…";
  }
  return parts.join(" · ");
}

// Human: "X of Y files" used on overall progress row (expanded + minimized).
export function formatUploadFilesProgress(processed: number, total: number): string {
  if (total <= 0) return "0 files";
  return `${processed} of ${total} file${total === 1 ? "" : "s"}`;
}

// Human: Queue backlog one-liner — matches download tray wording style.
export function formatUploadQueueSummary(count: number): string {
  if (count <= 0) return "";
  return `${count} file${count === 1 ? "" : "s"} waiting in queue`;
}

// Human: Done backlog one-liner for bulk batches.
export function formatUploadDoneSummary(count: number): string {
  if (count <= 0) return "";
  return `${count} file${count === 1 ? "" : "s"} done`;
}
