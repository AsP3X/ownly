// Human: Anonymous viewer page for a public share link — one file or a browsable folder.
// Agent: READS /public/shares/:token* without auth; SCOPED downloads only; NO drive navigation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";
import {
  ChevronRight,
  Download,
  FileIcon,
  Film,
  Folder,
  Loader2,
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
import { isFileProcessing } from "@/lib/file-processing";
import { formatBytes } from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";

type Breadcrumb = { id: string; name: string };

export default function PublicSharePage() {
  const { token = "" } = useParams<{ token: string }>();
  const [overview, setOverview] = useState<PublicShareInfo | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState("");
  const [streamLoading, setStreamLoading] = useState(false);

  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of folders) map.set(folder.id, folder.name);
    if (overview?.resource_type === "folder") {
      map.set(overview.resource_id, overview.name);
    }
    for (const crumb of breadcrumbs) map.set(crumb.id, crumb.name);
    return map;
  }, [folders, overview, breadcrumbs]);

  // Human: Load share metadata on mount or when token changes.
  // Agent: GET /public/shares/:token; SETS overview; BRANCHES file vs folder UI.
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
  // Agent: GET /public/shares/:token/contents?folder_id=.
  const loadFolderContents = useCallback(
    async (folderId: string) => {
      if (!token) return;
      setLoading(true);
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
        setLoading(false);
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

  // Human: Resolve which file id should drive HLS playback on this page.
  // Agent: FILE share uses resource_id; FOLDER share uses previewFile when modal open.
  const streamFileId = useMemo(() => {
    if (overview?.resource_type === "file" && overview.hls_ready) {
      return overview.resource_id;
    }
    if (previewFile?.hls_ready) return previewFile.id;
    return null;
  }, [overview, previewFile]);

  // Human: Load HLS stream for inline video preview on the public page.
  // Agent: GET public stream-url; USES hls.js without Authorization header.
  useEffect(() => {
    if (!token || !streamFileId) {
      setStreamUrl(null);
      return;
    }
    let cancelled = false;
    setStreamLoading(true);
    setStreamError("");
    void fetchPublicVideoStreamUrl(token, streamFileId)
      .then((res) => {
        if (cancelled) return;
        if (!res.url) {
          setStreamError(res.hls_encode_error ?? "Video is not ready for playback.");
          setStreamUrl(null);
          return;
        }
        const normalized = res.url.startsWith("http")
          ? res.url
          : res.url.startsWith("/")
            ? res.url
            : `/${res.url}`;
        setStreamUrl(normalized);
      })
      .catch((e) => {
        if (!cancelled) setStreamError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setStreamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, streamFileId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;
    let hls: Hls | null = null;
    if (streamUrl.includes("/playlist") && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setStreamError("Playback failed.");
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
    }
    return () => {
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl]);

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

  return (
    <div className="min-h-screen bg-[#f3f2f1] text-neutral-900">
      <header className="border-b border-neutral-200 bg-white px-4 py-4 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Shared link</p>
        <h1 className="mt-1 truncate text-xl font-semibold">{overview.name}</h1>
        {overview.resource_type === "file" && overview.size_bytes != null ? (
          <p className="mt-1 text-sm text-neutral-600">{formatBytes(overview.size_bytes)}</p>
        ) : null}
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {overview.resource_type === "file" ? (
          <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              {overview.mime_type?.startsWith("video/") ? (
                <Film className="size-8 text-violet-600" />
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

            {overview.mime_type?.startsWith("video/") && overview.hls_ready ? (
              <div className="space-y-2">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                  <video ref={videoRef} className="size-full object-contain" controls playsInline />
                  {streamLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
                      Loading stream…
                    </div>
                  ) : null}
                </div>
                {streamError ? <p className="text-sm text-destructive">{streamError}</p> : null}
              </div>
            ) : null}

            <Button
              disabled={downloadingId === overview.resource_id}
              onClick={() =>
                void handleDownload({
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
                  conversion_progress: 0,
                  duration_seconds: null,
                })
              }
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
          <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
            <nav className="flex flex-wrap items-center gap-1 border-b border-neutral-100 px-4 py-3 text-sm">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  {index > 0 ? <ChevronRight className="size-4 text-neutral-400" /> : null}
                  <button
                    type="button"
                    className={
                      index === breadcrumbs.length - 1
                        ? "font-medium text-neutral-900"
                        : "text-sky-700 hover:underline"
                    }
                    disabled={index === breadcrumbs.length - 1}
                    onClick={() => navigateToCrumb(crumb.id)}
                  >
                    {crumb.name || folderNameById.get(crumb.id) || "Folder"}
                  </button>
                </span>
              ))}
            </nav>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                Loading…
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {folders.map((folder) => (
                  <li key={folder.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                      onClick={() => openFolder(folder)}
                    >
                      <Folder className="size-5 shrink-0 text-amber-500" />
                      <span className="truncate font-medium">{folder.name}</span>
                    </button>
                  </li>
                ))}
                {files.map((file) => {
                  const processing = isFileProcessing(file);
                  return (
                    <li
                      key={file.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50"
                    >
                      <FileIcon className="size-5 shrink-0 text-sky-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{file.name}</p>
                        <p className="text-xs text-neutral-500">{formatBytes(file.size_bytes)}</p>
                      </div>
                      {processing ? <FileProcessingBadge file={file} /> : null}
                      {file.mime_type?.startsWith("video/") && file.hls_ready && !processing ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewFile(file)}
                        >
                          <Film />
                          Play
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={processing || downloadingId === file.id}
                        onClick={() => void handleDownload(file)}
                      >
                        {downloadingId === file.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Download />
                        )}
                        Download
                      </Button>
                    </li>
                  );
                })}
                {folders.length === 0 && files.length === 0 ? (
                  <li className="px-4 py-12 text-center text-sm text-neutral-500">
                    This folder is empty.
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        )}

        {previewFile ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="truncate font-semibold">{previewFile.name}</h2>
                <Button size="sm" variant="outline" onClick={() => setPreviewFile(null)}>
                  Close
                </Button>
              </div>
              <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                <video ref={videoRef} className="size-full object-contain" controls playsInline />
                {streamLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
                    Loading stream…
                  </div>
                ) : null}
              </div>
              {streamError ? <p className="mt-2 text-sm text-destructive">{streamError}</p> : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
