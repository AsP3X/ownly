// Human: Anonymous viewer page for a public share link — single file preview or browsable folder explorer.
// Agent: READS /public/shares/:token* without auth; RENDERS PublicShareExplorer + preview dialogs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";
import {
  attachHlsErrorHandler,
  attachVodSeekRecovery,
  createHlsInstance,
  isHlsStreamUrl,
} from "@/lib/hls-player";
import {
  Download,
  FileIcon,
  Film,
  ImageIcon,
  Loader2,
  Music,
} from "lucide-react";
import {
  downloadPublicShareFile,
  fetchPublicShareContents,
  fetchPublicShareOverview,
  fetchPublicVideoStreamUrl,
  getErrorMessage,
  type FileItem,
  type FolderItem,
  type PublicShareInfo,
} from "@/api/client";
import { PublicShareExplorer, type PublicShareBreadcrumb } from "@/components/public-share/PublicShareExplorer";
import { AudioPreviewDialog } from "@/components/drive/AudioPreviewDialog";
import { ImagePreviewDialog } from "@/components/drive/ImagePreviewDialog";
import { PdfPreviewDialog } from "@/components/drive/PdfPreviewDialog";
import { VideoPreviewDialog } from "@/components/drive/VideoPreviewDialog";
import { isFileProcessing } from "@/lib/file-processing";
import {
  buildAudioGallery,
  buildImageGallery,
  formatBytes,
  isAudioMime,
  isImageMime,
  isPdfMime,
} from "@/lib/utils-app";
import { Button } from "@/components/ui/button";

// Human: Build a minimal FileItem from single-file share overview metadata.
// Agent: MAPS PublicShareInfo → FileItem for preview dialogs on file-type shares.
function overviewAsFileItem(overview: PublicShareInfo): FileItem {
  return {
    id: overview.resource_id,
    name: overview.name,
    mime_type: overview.mime_type,
    size_bytes: overview.size_bytes ?? 0,
    folder_id: null,
    created_at: "",
    updated_at: "",
    hls_ready: overview.hls_ready ?? false,
    hls_encode_status: null,
    hls_encode_error: null,
    conversion_progress: overview.hls_ready ? 100 : 0,
    duration_seconds: null,
  };
}

export default function PublicSharePage() {
  const { token = "" } = useParams<{ token: string }>();
  const [overview, setOverview] = useState<PublicShareInfo | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<PublicShareBreadcrumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [previewVideo, setPreviewVideo] = useState<FileItem | null>(null);
  const [previewImage, setPreviewImage] = useState<FileItem | null>(null);
  const [previewPdf, setPreviewPdf] = useState<FileItem | null>(null);
  const [previewAudio, setPreviewAudio] = useState<FileItem | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [inlineStreamUrl, setInlineStreamUrl] = useState<string | null>(null);
  const [inlineStreamError, setInlineStreamError] = useState("");
  const [inlineStreamLoading, setInlineStreamLoading] = useState(false);

  // Human: Load share metadata on mount or when token changes.
  // Agent: GET /public/shares/:token; SETS overview; INITIALIZES folder breadcrumbs at share root.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPublicShareOverview(token)
      .then((res) => {
        if (cancelled) return;
        setOverview(res.share);
        if (res.share.resource_type === "folder") {
          setRootFolderId(res.share.resource_id);
          setCurrentFolderId(res.share.resource_id);
          setBreadcrumbs([{ id: res.share.resource_id, name: res.share.name }]);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Human: Reload folder contents when browsing inside a folder-type share.
  // Agent: GET /public/shares/:token/contents?folder_id=; UPDATES files/folders state.
  const loadFolderContents = useCallback(
    async (folderId: string) => {
      if (!token) return;
      setContentsLoading(true);
      setError("");
      try {
        const res = await fetchPublicShareContents(token, folderId);
        setFiles(res.files);
        setFolders(res.folders);
        setCurrentFolderId(res.current_folder_id);
        setRootFolderId(res.root_folder_id);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setContentsLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token || overview?.resource_type !== "folder" || !currentFolderId) return;
    void loadFolderContents(currentFolderId);
  }, [token, overview?.resource_type, currentFolderId, loadFolderContents]);

  async function handleDownload(file: FileItem) {
    if (!token || isFileProcessing(file)) return;
    setDownloadingId(file.id);
    setError("");
    try {
      await downloadPublicShareFile(token, file.id, file.name);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setDownloadingId(null);
    }
  }

  function openFolder(folder: FolderItem) {
    setBreadcrumbs((prev) => {
      const rootIndex = prev.findIndex((c) => c.id === rootFolderId);
      const base = rootIndex >= 0 ? prev.slice(0, rootIndex + 1) : prev;
      const existing = base.findIndex((c) => c.id === folder.id);
      if (existing >= 0) return base.slice(0, existing + 1);
      return [...base, { id: folder.id, name: folder.name }];
    });
    setCurrentFolderId(folder.id);
  }

  function navigateToCrumb(folderId: string) {
    setBreadcrumbs((prev) => {
      const index = prev.findIndex((c) => c.id === folderId);
      return index >= 0 ? prev.slice(0, index + 1) : prev;
    });
    setCurrentFolderId(folderId);
  }

  function handlePreviewVideo(file: FileItem) {
    if (isFileProcessing(file)) return;
    setPreviewVideo(file);
  }

  function handlePreviewImage(file: FileItem) {
    if (isFileProcessing(file) || !isImageMime(file.mime_type)) return;
    setPreviewImage(file);
  }

  function handlePreviewPdf(file: FileItem) {
    if (isFileProcessing(file) || !isPdfMime(file.mime_type)) return;
    setPreviewPdf(file);
  }

  function handlePreviewAudio(file: FileItem) {
    if (isFileProcessing(file) || !isAudioMime(file.mime_type)) return;
    setPreviewAudio(file);
  }

  const galleryImages = useMemo(() => {
    if (!previewImage) return [];
    return buildImageGallery(files, previewImage);
  }, [files, previewImage]);

  const galleryAudio = useMemo(() => {
    if (!previewAudio) return [];
    return buildAudioGallery(files, previewAudio);
  }, [files, previewAudio]);

  const singleFileItem = overview?.resource_type === "file" ? overviewAsFileItem(overview) : null;

  // Human: Inline HLS player for single-file video shares (no modal needed on the landing view).
  // Agent: GET public stream-url when overview is one hls_ready video file.
  const inlineVideoFileId = useMemo(() => {
    if (overview?.resource_type !== "file") return null;
    if (!overview.mime_type?.startsWith("video/") || !overview.hls_ready) return null;
    return overview.resource_id;
  }, [overview]);

  useEffect(() => {
    if (!token || !inlineVideoFileId) {
      setInlineStreamUrl(null);
      return;
    }
    let cancelled = false;
    setInlineStreamLoading(true);
    setInlineStreamError("");
    void fetchPublicVideoStreamUrl(token, inlineVideoFileId)
      .then((res) => {
        if (cancelled) return;
        if (!res.url) {
          setInlineStreamError(res.hls_encode_error ?? "Video is not ready for playback.");
          setInlineStreamUrl(null);
          return;
        }
        const normalized = res.url.startsWith("http")
          ? res.url
          : new URL(
              res.url.startsWith("/") ? res.url : `/${res.url}`,
              window.location.origin,
            ).href;
        setInlineStreamUrl(normalized);
      })
      .catch((e) => {
        if (!cancelled) setInlineStreamError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setInlineStreamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, inlineVideoFileId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !inlineStreamUrl) return;
    let hls: Hls | null = null;
    let disposed = false;
    let detachSeek: (() => void) | undefined;
    const isActive = () => !disposed;

    if (isHlsStreamUrl(inlineStreamUrl) && Hls.isSupported()) {
      hls = createHlsInstance();
      hls.loadSource(inlineStreamUrl);
      hls.attachMedia(video);
      attachHlsErrorHandler(hls, video, isActive, (message) => {
        if (!disposed) setInlineStreamError(message);
      });
      detachSeek = attachVodSeekRecovery(hls, video, isActive);
    } else if (isHlsStreamUrl(inlineStreamUrl) && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = inlineStreamUrl;
    } else if (isHlsStreamUrl(inlineStreamUrl)) {
      setInlineStreamError("This browser cannot play HLS video.");
    }
    return () => {
      disposed = true;
      detachSeek?.();
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [inlineStreamUrl]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Invalid share link.
      </div>
    );
  }

  if (loading && !overview) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Loading shared content…
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-destructive">{error}</p>
        <p className="text-sm text-muted-foreground">
          This link may have been revoked or the file no longer exists.
        </p>
      </div>
    );
  }

  if (!overview) return null;

  const isSingleFile = overview.resource_type === "file";
  const singleMime = overview.mime_type ?? "";
  const singleIsImage = isImageMime(singleMime);
  const singleIsPdf = isPdfMime(singleMime);
  const singleIsAudio = isAudioMime(singleMime);
  const singleIsVideo = singleMime.startsWith("video/");

  return (
    <div className="flex min-h-screen flex-col bg-[#f3f2f1] text-neutral-900">
      <header className="border-b border-neutral-200 bg-white px-4 py-3 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Shared link</p>
        <h1 className="mt-0.5 truncate text-xl font-semibold">{overview.name}</h1>
        {isSingleFile && overview.size_bytes != null ? (
          <p className="mt-0.5 text-sm text-neutral-600">{formatBytes(overview.size_bytes)}</p>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-3 py-4 sm:px-6 sm:py-6">
        {error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {isSingleFile && singleFileItem ? (
          <div className="mx-auto w-full max-w-3xl space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              {singleIsVideo ? (
                <Film className="size-8 text-violet-600" />
              ) : singleIsImage ? (
                <ImageIcon className="size-8 text-blue-600" />
              ) : singleIsAudio ? (
                <Music className="size-8 text-blue-600" />
              ) : (
                <FileIcon className="size-8 text-sky-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{overview.name}</p>
                {overview.size_bytes != null ? (
                  <p className="text-sm text-neutral-600">{formatBytes(overview.size_bytes)}</p>
                ) : null}
              </div>
            </div>

            {singleIsVideo && overview.hls_ready ? (
              <div className="space-y-2">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                  <video ref={videoRef} className="size-full object-contain" controls playsInline />
                  {inlineStreamLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
                      Loading stream…
                    </div>
                  ) : null}
                </div>
                {inlineStreamError ? <p className="text-sm text-destructive">{inlineStreamError}</p> : null}
              </div>
            ) : null}

            {singleIsImage ? (
              <Button variant="outline" onClick={() => handlePreviewImage(singleFileItem)}>
                <ImageIcon />
                View image
              </Button>
            ) : null}

            {singleIsPdf ? (
              <Button variant="outline" onClick={() => handlePreviewPdf(singleFileItem)}>
                <FileIcon />
                View PDF
              </Button>
            ) : null}

            {singleIsAudio ? (
              <Button variant="outline" onClick={() => handlePreviewAudio(singleFileItem)}>
                <Music />
                Play audio
              </Button>
            ) : null}

            <Button
              disabled={downloadingId === overview.resource_id}
              onClick={() => void handleDownload(singleFileItem)}
            >
              {downloadingId === overview.resource_id ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              Download
            </Button>
          </div>
        ) : (
          <PublicShareExplorer
            shareName={overview.name}
            folders={folders}
            files={files}
            breadcrumbs={breadcrumbs}
            loading={contentsLoading}
            downloadingId={downloadingId}
            onOpenFolder={openFolder}
            onNavigateBreadcrumb={navigateToCrumb}
            onDownload={(file) => void handleDownload(file)}
            onPreviewVideo={handlePreviewVideo}
            onPreviewImage={handlePreviewImage}
            onPreviewPdf={handlePreviewPdf}
            onPreviewAudio={handlePreviewAudio}
          />
        )}
      </main>

      <VideoPreviewDialog
        file={previewVideo}
        open={previewVideo !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewVideo(null);
        }}
        shareToken={token}
      />

      <ImagePreviewDialog
        images={galleryImages.length > 0 ? galleryImages : previewImage ? [previewImage] : []}
        file={previewImage}
        open={previewImage !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewImage(null);
        }}
        onFileChange={setPreviewImage}
        shareToken={token}
      />

      <PdfPreviewDialog
        file={previewPdf}
        open={previewPdf !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewPdf(null);
        }}
        shareToken={token}
      />

      <AudioPreviewDialog
        tracks={galleryAudio.length > 0 ? galleryAudio : previewAudio ? [previewAudio] : []}
        file={previewAudio}
        open={previewAudio !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewAudio(null);
        }}
        onFileChange={setPreviewAudio}
        shareToken={token}
      />
    </div>
  );
}
