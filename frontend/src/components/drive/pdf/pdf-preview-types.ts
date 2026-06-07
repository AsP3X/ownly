// Human: Props for PDF preview dialog — shared by desktop shell, mobile shell, and controller hook.
// Agent: READ by DrivePage, PublicSharePage via DynamicImportPreview; WRITES open/file to preview handlers.

import type { FileItem } from "@/api/client";

export type PdfPreviewDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, PDF bytes load through anonymous public share download. */
  shareToken?: string;
  sharePassword?: string | null;
  /** Human: Optional download action — shown in the header when provided. */
  onDownload?: (file: FileItem) => void;
};
