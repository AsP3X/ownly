// Human: Anonymous viewer page for public share links — Pencil variants for folder list and inline previews.
// Agent: READS /public/shares/:token*; RENDERS layout shell + type-specific panels; OPENS dialogs inside folders.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Film, Loader2 } from "lucide-react";
import {
  downloadPublicShareFile,
  fetchPublicShareAllFiles,
  fetchPublicShareContents,
  fetchPublicShareOverview,
  fetchPublicVideoStreamUrl,
  getErrorMessage,
  saveFromPublicShare,
  verifyPublicShareAccess,
  type FileItem,
  type FolderItem,
  type PublicShareInfo,
} from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { downloadPublicShareFiles } from "@/lib/public-share-download";
import {
  clearStoredSharePassword,
  getStoredSharePassword,
  setStoredSharePassword,
} from "@/lib/share-access";
import { PublicShareExplorer, type PublicShareBreadcrumb } from "@/components/public-share/PublicShareExplorer";
import { PublicShareInlineAudio } from "@/components/public-share/PublicShareInlineAudio";
import { PublicShareInlineImage } from "@/components/public-share/PublicShareInlineImage";
import { PublicShareInlinePdf } from "@/components/public-share/PublicShareInlinePdf";
import { PublicShareInlineVideo } from "@/components/public-share/PublicShareInlineVideo";
import { PublicSharePageLayout } from "@/components/public-share/PublicSharePageLayout";
import { PublicSharePasswordGate } from "@/components/public-share/PublicSharePasswordGate";
import { AudioPreviewDialog } from "@/components/drive/AudioPreviewDialog";
import { ImagePreviewDialog } from "@/components/drive/ImagePreviewDialog";
import { PdfPreviewDialog } from "@/components/drive/PdfPreviewDialog";
import { VideoPreviewDialog } from "@/components/drive/VideoPreviewDialog";
import { isFileProcessing } from "@/lib/file-processing";
import {
  buildAudioGallery,
  buildImageGallery,
  buildVideoGallery,
  formatBytes,
  isAudioMime,
  isImageMime,
  isPdfMime,
} from "@/lib/utils-app";

// Human: Build a minimal FileItem from single-file share overview metadata.
// Agent: MAPS PublicShareInfo → FileItem for preview dialogs and inline panels.
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
  const navigate = useNavigate();
  const location = useLocation();
  const { token: authToken } = useAuth();
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
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [allFolders, setAllFolders] = useState<FolderItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [previewVideo, setPreviewVideo] = useState<FileItem | null>(null);
  const [previewImage, setPreviewImage] = useState<FileItem | null>(null);
  const [previewPdf, setPreviewPdf] = useState<FileItem | null>(null);
  const [previewAudio, setPreviewAudio] = useState<FileItem | null>(null);

  const [inlineStreamUrl, setInlineStreamUrl] = useState<string | null>(null);
  const [inlineStreamError, setInlineStreamError] = useState("");
  const [inlineStreamLoading, setInlineStreamLoading] = useState(false);
  const [sharePassword, setSharePassword] = useState<string | null>(null);
  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [passwordError, setPasswordError] = useState("");

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

  useEffect(() => {
    setSharePassword(null);
    setAccessGranted(false);
    setPasswordInput("");
    setPasswordError("");
  }, [token]);

  useEffect(() => {
    if (!token || !overview) return;
    if (!overview.requires_password) {
      setAccessGranted(true);
      return;
    }

    const stored = getStoredSharePassword(token);
    if (!stored) {
      setAccessGranted(false);
      return;
    }

    let cancelled = false;
    void verifyPublicShareAccess(token, overview.resource_type, overview.resource_id, stored)
      .then(() => {
        if (cancelled) return;
        setSharePassword(stored);
        setAccessGranted(true);
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredSharePassword(token);
        setSharePassword(null);
        setAccessGranted(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, overview]);

  const loadFolderContents = useCallback(
    async (folderId: string) => {
      if (!token) return;
      setContentsLoading(true);
      setError("");
      try {
        const res = await fetchPublicShareContents(token, folderId, sharePassword);
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
    [token, sharePassword],
  );

  useEffect(() => {
    if (!token || overview?.resource_type !== "folder" || !currentFolderId || !accessGranted) return;
    void loadFolderContents(currentFolderId);
  }, [token, overview?.resource_type, currentFolderId, loadFolderContents, accessGranted]);

  // Human: Load the full share tree for sidebar totals, search, zip download-all, and save.
  // Agent: GET /public/shares/:token/all-files after password unlock.
  useEffect(() => {
    if (!token || !accessGranted) {
      setAllFiles([]);
      setAllFolders([]);
      return;
    }
    let cancelled = false;
    setTreeLoading(true);
    void fetchPublicShareAllFiles(token, sharePassword)
      .then((res) => {
        if (cancelled) return;
        setAllFiles(res.files);
        setAllFolders(res.folders);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, sharePassword, accessGranted]);

  async function handleDownload(file: FileItem) {
    if (!token || isFileProcessing(file) || overview?.block_download) return;
    setDownloadingId(file.id);
    setError("");
    try {
      await downloadPublicShareFile(token, file.id, file.name, sharePassword);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleBulkDownload(fileList: FileItem[]) {
    if (!token || overview?.block_download || fileList.length === 0) return;
    const ready = fileList.filter((f) => !isFileProcessing(f));
    if (ready.length === 0) return;
    setBulkDownloading(true);
    setError("");
    try {
      await downloadPublicShareFiles(token, ready, sharePassword);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBulkDownloading(false);
    }
  }

  async function handleSaveToOwnly(fileIds?: string[]) {
    if (!token || !overview || overview.block_download) return;
    if (!authToken) {
      navigate("/login", { state: { from: location.pathname } });
      return;
    }
    setSaveLoading(true);
    setSaveMessage("");
    setError("");
    try {
      const ids =
        fileIds ??
        (overview.resource_type === "file"
          ? [overview.resource_id]
          : allFiles.map((f) => f.id));
      const res = await saveFromPublicShare({
        token,
        file_ids: ids,
        sharePassword,
      });
      setSaveMessage(
        res.saved_count === 1
          ? "Saved 1 file to your drive."
          : `Saved ${res.saved_count} files to your drive.`,
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaveLoading(false);
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

  async function handleUnlockPassword(event: FormEvent) {
    event.preventDefault();
    if (!token || !overview) return;
    const password = passwordInput.trim();
    if (!password) {
      setPasswordError("Enter the share password.");
      return;
    }

    setUnlocking(true);
    setPasswordError("");
    try {
      await verifyPublicShareAccess(token, overview.resource_type, overview.resource_id, password);
      setStoredSharePassword(token, password);
      setSharePassword(password);
      setAccessGranted(true);
    } catch (e) {
      setPasswordError(getErrorMessage(e));
    } finally {
      setUnlocking(false);
    }
  }

  const singleFileItem = useMemo(
    () => (overview?.resource_type === "file" ? overviewAsFileItem(overview) : null),
    [overview],
  );

  const inlineVideoFileId = useMemo(() => {
    if (overview?.resource_type !== "file") return null;
    if (!overview.mime_type?.startsWith("video/") || !overview.hls_ready) return null;
    return overview.resource_id;
  }, [overview]);

  useEffect(() => {
    if (!token || !inlineVideoFileId || !accessGranted) {
      setInlineStreamUrl(null);
      return;
    }
    let cancelled = false;
    setInlineStreamLoading(true);
    setInlineStreamError("");
    void fetchPublicVideoStreamUrl(token, inlineVideoFileId, sharePassword)
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
  }, [token, inlineVideoFileId, sharePassword, accessGranted]);

  const galleryImages = useMemo(() => {
    if (!previewImage) return [];
    return buildImageGallery(files, previewImage);
  }, [files, previewImage]);

  const galleryAudio = useMemo(() => {
    if (!previewAudio) return [];
    return buildAudioGallery(files, previewAudio);
  }, [files, previewAudio]);

  const galleryVideos = useMemo(() => {
    if (!previewVideo) return [];
    return buildVideoGallery(files, previewVideo);
  }, [files, previewVideo]);

  const downloadHeaderLabel = useMemo(() => {
    if (!overview) return "Download";
    if (overview.block_download) return "Downloads disabled";
    if (overview.resource_type === "file" && overview.size_bytes != null) {
      return `Download File (${formatBytes(overview.size_bytes)})`;
    }
    if (overview.total_bytes > 0) {
      return `Download All (${formatBytes(overview.total_bytes)})`;
    }
    return "Download All";
  }, [overview]);

  function handleHeaderDownload() {
    if (!overview || overview.block_download) return;
    if (overview.resource_type === "file" && singleFileItem) {
      void handleDownload(singleFileItem);
      return;
    }
    const targets = allFiles.filter((f) => !isFileProcessing(f));
    void handleBulkDownload(targets);
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] text-[#666666]">
        Invalid share link.
      </div>
    );
  }

  if (loading && !overview) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-[#F7F8FA] text-[#666666]">
        <Loader2 className="size-5 animate-spin" />
        Loading shared content…
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F7F8FA] px-4 text-center">
        <p className="text-destructive">{error}</p>
        <p className="text-sm text-[#666666]">
          This link may have been revoked or the file no longer exists.
        </p>
      </div>
    );
  }

  if (!overview) return null;

  if (overview.requires_password && !accessGranted) {
    return (
      <PublicSharePasswordGate
        resourceType={overview.resource_type}
        shareName={overview.name}
        password={passwordInput}
        onPasswordChange={setPasswordInput}
        error={passwordError}
        loading={unlocking}
        onSubmit={(event) => void handleUnlockPassword(event)}
      />
    );
  }

  const isFolderShare = overview.resource_type === "folder";
  const singleMime = overview.mime_type ?? "";
  const singleIsImage = isImageMime(singleMime);
  const singleIsPdf = isPdfMime(singleMime);
  const singleIsAudio = isAudioMime(singleMime);
  const singleIsVideo = singleMime.startsWith("video/");

  return (
    <>
      <PublicSharePageLayout
        overview={overview}
        downloadLabel={downloadHeaderLabel}
        onDownload={handleHeaderDownload}
        onSave={() => void handleSaveToOwnly()}
        downloadDisabled={overview.block_download}
        downloadLoading={Boolean(downloadingId) || bulkDownloading || treeLoading}
        saveDisabled={overview.block_download}
        saveLoading={saveLoading}
      >
        {error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {saveMessage ? (
          <p className="mb-4 text-sm text-[#166534]" role="status">
            {saveMessage}
          </p>
        ) : null}

        {isFolderShare ? (
          <PublicShareExplorer
            shareName={overview.name}
            folders={folders}
            files={files}
            allFiles={allFiles}
            allFolders={allFolders}
            breadcrumbs={breadcrumbs}
            loading={contentsLoading}
            downloadingId={downloadingId}
            onOpenFolder={openFolder}
            onNavigateBreadcrumb={navigateToCrumb}
            onDownload={(file) => void handleDownload(file)}
            onPreviewVideo={(file) => setPreviewVideo(file)}
            onPreviewImage={(file) => setPreviewImage(file)}
            onPreviewPdf={(file) => setPreviewPdf(file)}
            onPreviewAudio={(file) => setPreviewAudio(file)}
            allowDownload={!overview.block_download}
            onBulkDownload={(list) => void handleBulkDownload(list)}
          />
        ) : singleFileItem ? (
          <div className="flex flex-col gap-4">
            {singleIsVideo && !overview.hls_ready ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-8 text-center shadow-[0_12px_32px_#00000014]">
                <Film className="mx-auto size-10 text-violet-600" aria-hidden />
                <p className="mt-3 font-semibold text-[#1A1A1A]">{overview.name}</p>
                <p className="mt-2 text-sm text-[#666666]">
                  This video is still processing. Refresh the page in a few minutes to watch it here.
                </p>
              </div>
            ) : null}
            {singleIsVideo && overview.hls_ready ? (
              <PublicShareInlineVideo
                file={singleFileItem}
                streamUrl={inlineStreamUrl}
                streamLoading={inlineStreamLoading}
                streamError={inlineStreamError}
                sharePassword={sharePassword}
                onStreamError={setInlineStreamError}
              />
            ) : null}
            {singleIsImage ? (
              <PublicShareInlineImage
                token={token}
                file={singleFileItem}
                sharePassword={sharePassword}
                onDownload={
                  overview.block_download ? undefined : () => void handleDownload(singleFileItem)
                }
                downloadDisabled={overview.block_download || downloadingId === singleFileItem.id}
              />
            ) : null}
            {singleIsPdf ? (
              <PublicShareInlinePdf token={token} file={singleFileItem} sharePassword={sharePassword} />
            ) : null}
            {singleIsAudio ? (
              <PublicShareInlineAudio
                token={token}
                file={singleFileItem}
                sharePassword={sharePassword}
                showMobileActions
                onDownload={overview.block_download ? undefined : () => void handleDownload(singleFileItem)}
                onSave={() => void handleSaveToOwnly()}
                downloadDisabled={overview.block_download}
                downloadLoading={downloadingId === singleFileItem.id}
                saveDisabled={overview.block_download}
                saveLoading={saveLoading}
              />
            ) : null}
            {!singleIsVideo && !singleIsImage && !singleIsPdf && !singleIsAudio ? (
              <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-[0_12px_32px_#00000014]">
                <p className="font-semibold text-[#1A1A1A]">{overview.name}</p>
                {overview.size_bytes != null ? (
                  <p className="mt-1 text-sm text-[#666666]">{formatBytes(overview.size_bytes)}</p>
                ) : null}
                <p className="mt-4 text-sm text-[#666666]">
                  Preview is not available for this file type. Use the download button above.
                </p>
              </div>
            ) : null}
            {overview.block_download ? (
              <p className="text-xs text-[#888888]">Downloads are disabled for this link.</p>
            ) : null}
          </div>
        ) : null}
      </PublicSharePageLayout>

      <VideoPreviewDialog
        videos={
          galleryVideos.length > 0
            ? galleryVideos
            : previewVideo
              ? [previewVideo]
              : []
        }
        file={previewVideo}
        open={previewVideo !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewVideo(null);
        }}
        onFileChange={setPreviewVideo}
        shareToken={token}
        sharePassword={sharePassword}
        onDownload={overview?.block_download ? undefined : (file) => void handleDownload(file)}
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
        sharePassword={sharePassword}
        onDownload={overview.block_download ? undefined : (file) => void handleDownload(file)}
      />

      <PdfPreviewDialog
        file={previewPdf}
        open={previewPdf !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewPdf(null);
        }}
        shareToken={token}
        sharePassword={sharePassword}
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
        sharePassword={sharePassword}
      />
    </>
  );
}
