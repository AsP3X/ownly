// Human: Code-split heavy media preview dialogs — react-pdf and hls.js load on first open.
// Agent: EXPORTS React.lazy wrappers; CONSUMED by DrivePage and PublicSharePage inside Suspense.

import { lazyNamed } from "@/lib/lazy-named";

export const LazyVideoPreviewDialog = lazyNamed(
  () => import("@/components/drive/VideoPreviewDialog"),
  "VideoPreviewDialog",
);

export const LazyPdfPreviewDialog = lazyNamed(
  () => import("@/components/drive/PdfPreviewDialog"),
  "PdfPreviewDialog",
);

export const LazyImagePreviewDialog = lazyNamed(
  () => import("@/components/drive/ImagePreviewDialog"),
  "ImagePreviewDialog",
);

export const LazyAudioPreviewDialog = lazyNamed(
  () => import("@/components/drive/AudioPreviewDialog"),
  "AudioPreviewDialog",
);
