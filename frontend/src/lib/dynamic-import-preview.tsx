// Human: Mount code-split preview dialogs via dynamic import() — keeps image/audio/PDF/video off the drive chunk.
// Agent: EXPORTS DynamicImportPreview gate + cached load*PreviewDialog factories for drive/share pages.

import { useEffect, useState, type ComponentType } from "react";
import type { AudioPreviewDialogProps } from "@/components/drive/AudioPreviewDialog";
import type { ImagePreviewDialogProps } from "@/components/drive/ImagePreviewDialog";
import type { PdfPreviewDialogProps } from "@/components/drive/PdfPreviewDialog";
import type { ExcelSpreadsheetDialogProps } from "@/components/drive/ExcelSpreadsheetDialog";
import type { TextCodeEditorDialogProps } from "@/components/drive/TextCodeEditorDialog";
import type { VideoPreviewDialogProps } from "@/components/drive/VideoPreviewDialog";

type DynamicImportPreviewProps<P extends object> = {
  loader: () => Promise<ComponentType<P>>;
  previewProps: P;
};

// Human: Generic gate — parent passes import() factory so the preview chunk stays out of the page bundle.
// Agent: READS loader promise; WRITES Component state once; RETURNS null while chunk loads.
export function DynamicImportPreview<P extends object>({
  loader,
  previewProps,
}: DynamicImportPreviewProps<P>) {
  const [PreviewComponent, setPreviewComponent] = useState<ComponentType<P> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loader().then((component) => {
      if (!cancelled) setPreviewComponent(() => component);
    });
    return () => {
      cancelled = true;
    };
  }, [loader]);

  if (!PreviewComponent) return null;
  return <PreviewComponent {...previewProps} />;
}

let cachedImagePreviewDialog: ComponentType<ImagePreviewDialogProps> | null = null;

// Human: Load ImagePreviewDialog on first open — not bundled with DrivePage.
// Agent: dynamic import(); CACHES module singleton for faster reopen.
export function loadImagePreviewDialog(): Promise<ComponentType<ImagePreviewDialogProps>> {
  if (cachedImagePreviewDialog) return Promise.resolve(cachedImagePreviewDialog);
  return import("@/components/drive/ImagePreviewDialog").then((module) => {
    cachedImagePreviewDialog = module.ImagePreviewDialog;
    return module.ImagePreviewDialog;
  });
}

let cachedAudioPreviewDialog: ComponentType<AudioPreviewDialogProps> | null = null;

// Human: Load AudioPreviewDialog on first open — not bundled with DrivePage.
// Agent: dynamic import(); CACHES module singleton for faster reopen.
export function loadAudioPreviewDialog(): Promise<ComponentType<AudioPreviewDialogProps>> {
  if (cachedAudioPreviewDialog) return Promise.resolve(cachedAudioPreviewDialog);
  return import("@/components/drive/AudioPreviewDialog").then((module) => {
    cachedAudioPreviewDialog = module.AudioPreviewDialog;
    return module.AudioPreviewDialog;
  });
}

let cachedPdfPreviewDialog: ComponentType<PdfPreviewDialogProps> | null = null;

// Human: Load PdfPreviewDialog on first open — pulls react-pdf chunk on demand.
// Agent: dynamic import(); CACHES module singleton for faster reopen.
export function loadPdfPreviewDialog(): Promise<ComponentType<PdfPreviewDialogProps>> {
  if (cachedPdfPreviewDialog) return Promise.resolve(cachedPdfPreviewDialog);
  return import("@/components/drive/PdfPreviewDialog").then((module) => {
    cachedPdfPreviewDialog = module.PdfPreviewDialog;
    return module.PdfPreviewDialog;
  });
}

let cachedExcelSpreadsheetDialog: ComponentType<ExcelSpreadsheetDialogProps> | null = null;

// Human: Load ExcelSpreadsheetDialog on first open — pulls xlsx chunk on demand.
// Agent: dynamic import(); CACHES module singleton for faster reopen.
export function loadExcelSpreadsheetDialog(): Promise<ComponentType<ExcelSpreadsheetDialogProps>> {
  if (cachedExcelSpreadsheetDialog) return Promise.resolve(cachedExcelSpreadsheetDialog);
  return import("@/components/drive/ExcelSpreadsheetDialog").then((module) => {
    cachedExcelSpreadsheetDialog = module.ExcelSpreadsheetDialog;
    return module.ExcelSpreadsheetDialog;
  });
}

let cachedTextCodeEditorDialog: ComponentType<TextCodeEditorDialogProps> | null = null;

// Human: Load TextCodeEditorDialog on first open — keeps editor chunk off the drive bundle.
// Agent: dynamic import(); CACHES module singleton for faster reopen.
export function loadTextCodeEditorDialog(): Promise<ComponentType<TextCodeEditorDialogProps>> {
  if (cachedTextCodeEditorDialog) return Promise.resolve(cachedTextCodeEditorDialog);
  return import("@/components/drive/TextCodeEditorDialog").then((module) => {
    cachedTextCodeEditorDialog = module.TextCodeEditorDialog;
    return module.TextCodeEditorDialog;
  });
}

let cachedVideoPreviewDialog: ComponentType<VideoPreviewDialogProps> | null = null;

// Human: Load VideoPreviewDialog on first open — pulls hls.js chunk on demand.
// Agent: dynamic import(); CACHES module singleton for faster reopen.
export function loadVideoPreviewDialog(): Promise<ComponentType<VideoPreviewDialogProps>> {
  if (cachedVideoPreviewDialog) return Promise.resolve(cachedVideoPreviewDialog);
  return import("@/components/drive/VideoPreviewDialog").then((module) => {
    cachedVideoPreviewDialog = module.VideoPreviewDialog;
    return module.VideoPreviewDialog;
  });
}
