// Human: PDF preview entry — mounts desktop Explorer viewer or Pencil mobile full-bleed viewer by viewport.
// Agent: CALLS usePdfPreviewController; RENDERS PdfPreviewDialogDesktop | PdfPreviewSurfaceMobile via useIsDesktopPlayer.

import { useIsDesktopPlayer } from "@/hooks/useVideoPlayerLayout";
import { PdfPreviewDialogDesktop } from "@/components/drive/pdf/PdfPreviewDialogDesktop";
import { PdfPreviewSurfaceMobile } from "@/components/drive/pdf/PdfPreviewSurfaceMobile";
import type { PdfPreviewDialogProps } from "@/components/drive/pdf/pdf-preview-types";
import { usePdfPreviewController } from "@/components/drive/pdf/usePdfPreviewController";

export type { PdfPreviewDialogProps } from "@/components/drive/pdf/pdf-preview-types";

export function PdfPreviewDialog({
  file,
  open,
  onOpenChange,
  shareToken,
  sharePassword,
  onDownload,
}: PdfPreviewDialogProps) {
  const isDesktop = useIsDesktopPlayer(open);
  const variant = isDesktop ? "desktop" : "mobile";
  const vm = usePdfPreviewController({ file, open, shareToken, sharePassword }, variant);

  if (isDesktop) {
    return (
      <PdfPreviewDialogDesktop
        open={open}
        onOpenChange={onOpenChange}
        onDownload={onDownload}
        vm={vm}
        onDocumentLoadError={vm.reportDocumentError}
      />
    );
  }

  return (
    <PdfPreviewSurfaceMobile
      open={open}
      onOpenChange={onOpenChange}
      onDownload={onDownload}
      vm={vm}
      onDocumentLoadError={vm.reportDocumentError}
    />
  );
}
