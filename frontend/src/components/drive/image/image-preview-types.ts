// Human: Shared props for ImagePreviewDialog and its controller hook.
// Agent: EXPORTED by ImagePreviewDialog; READ by useImagePreviewController and surface components.

import type { FileItem } from "@/api/client";

export type ImagePreviewDialogProps = {
  images: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (file: FileItem) => void;
  /** When set, image bytes load through anonymous public share download. */
  shareToken?: string;
  sharePassword?: string | null;
  /** Human: Optional download action — shown in the bottom bar when provided. */
  onDownload?: (file: FileItem) => void;
  /** Human: Optional share action — hidden on anonymous public share views. */
  onShare?: (file: FileItem) => void;
  /** Human: When set, preview blobs are downscaled to this max edge (mobile carousel). */
  previewDisplayMaxEdgePx?: number | null;
};
