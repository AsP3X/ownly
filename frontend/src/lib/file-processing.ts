// Human: Helpers for files still undergoing server-side work (HLS video or audio waveform analysis).
// Agent: READS FileItem HLS + audio fields; USED by drive UI to disable actions and show badges.

import type { FileItem } from "@/api/client";

// Human: True while a video upload is queued or actively transcoding on the server.
// Agent: READS mime_type, hls_ready, hls_encode_status; FALSE when ingest failed or finished.
function isVideoProcessing(file: FileItem): boolean {
  if (!file.mime_type?.startsWith("video/") || file.hls_ready) {
    return false;
  }
  return file.hls_encode_status !== "failed" && file.hls_encode_status !== "cancelled";
}

// Human: True while an audio upload is queued or generating its waveform sidecar.
// Agent: READS mime_type, audio_waveform_ready, audio_encode_status; FALSE when failed or ready.
function isAudioProcessing(file: FileItem): boolean {
  if (!file.mime_type?.startsWith("audio/") || file.audio_waveform_ready) {
    return false;
  }
  return file.audio_encode_status !== "failed" && file.audio_encode_status !== "cancelled";
}

export function isFileProcessing(file: FileItem): boolean {
  return isVideoProcessing(file) || isAudioProcessing(file);
}

// Human: Short label for the processing badge in file rows and grid tiles.
// Agent: READS conversion_progress + encode status; RETURNS video or audio status text.
export function fileProcessingLabel(file: FileItem): string {
  if (isAudioProcessing(file)) {
    if (file.audio_encode_status === "queued") {
      return "Processing file";
    }
    if (file.conversion_progress >= 75) {
      const storagePercent = Math.min(
        99,
        Math.round(((file.conversion_progress - 75) / 25) * 100),
      );
      return storagePercent > 0 ? `Moving to storage ${storagePercent}%` : "Moving to storage";
    }
    if (file.conversion_progress >= 45) {
      const encryptPercent = Math.min(
        99,
        Math.round(((file.conversion_progress - 45) / 30) * 100),
      );
      return encryptPercent > 0 ? `Encrypting (AES-256) ${encryptPercent}%` : "Encrypting (AES-256)";
    }
    const percent = Math.min(99, Math.max(0, file.conversion_progress));
    return percent > 0 ? `Processing file ${percent}%` : "Processing file";
  }

  if (file.hls_encode_status === "queued") {
    return "Processing file";
  }
  if (file.conversion_progress >= 50) {
    const storagePercent = Math.min(
      99,
      Math.round(((file.conversion_progress - 50) / 50) * 100),
    );
    return storagePercent > 0 ? `Moving to storage ${storagePercent}%` : "Moving to storage";
  }
  if (file.conversion_progress >= 40) {
    const encryptPercent = Math.min(
      99,
      Math.round(((file.conversion_progress - 40) / 10) * 100),
    );
    return encryptPercent > 0 ? `Encrypting (AES-256) ${encryptPercent}%` : "Encrypting (AES-256)";
  }
  if (file.conversion_progress > 0) {
    const encodePercent = Math.min(99, Math.round((file.conversion_progress / 40) * 100));
    return encodePercent > 0 ? `Processing file ${encodePercent}%` : "Processing file";
  }
  return "Processing file";
}

// Human: Shorter badge copy for narrow grid tiles so labels do not bleed into neighbors.
// Agent: READS fileProcessingLabel; RETURNS abbreviated phase text with percent when present.
export function fileProcessingCompactLabel(file: FileItem): string {
  const label = fileProcessingLabel(file);
  if (label.startsWith("Moving to storage")) {
    const percent = label.match(/(\d+)%/)?.[1];
    return percent ? `Storage ${percent}%` : "Storage";
  }
  if (label.startsWith("Encrypting")) {
    const percent = label.match(/(\d+)%/)?.[1];
    return percent ? `Encrypting ${percent}%` : "Encrypting";
  }
  if (label.startsWith("Processing file")) {
    const percent = label.match(/(\d+)%/)?.[1];
    return percent ? `Processing ${percent}%` : "Processing";
  }
  return label;
}

// Human: True when server progress is in the Nebular upload half of HLS ingest.
// Agent: READS conversion_progress >= 50 while hls_ready is false.
export function isFileMovingToStorage(file: FileItem): boolean {
  return isVideoProcessing(file) && file.conversion_progress >= 50;
}
