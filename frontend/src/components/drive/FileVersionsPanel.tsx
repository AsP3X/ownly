// Human: Version history for one file inside the details dialog — view, download, or restore a past revision.
// Agent: CALLS listFileVersions/restoreFileVersion/downloadFileVersion; EMITS onRestored after a restore.

import { useCallback, useEffect, useState } from "react";
import { Download, History, Loader2, RotateCcw } from "lucide-react";
import {
  downloadFileVersion,
  getErrorMessage,
  listFileVersions,
  restoreFileVersion,
  type FileItem,
  type FileVersion,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toastError, toastSuccess } from "@/lib/toast";
import { formatBytes, formatFileOpened } from "@/lib/utils-app";

type FileVersionsPanelProps = {
  file: FileItem;
  /** Human: Parent refreshes the row after a restore swaps the live bytes. */
  onRestored?: (file: FileItem) => void;
};

// Human: Who or what produced the revision that replaced this one.
function originLabel(version: FileVersion): string {
  switch (version.created_via) {
    case "public_share":
      return "Replaced via public link";
    case "restore":
      return "Replaced by a restore";
    default:
      return version.created_by_email
        ? `Replaced by ${version.created_by_email}`
        : "Replaced by a removed account";
  }
}

export function FileVersionsPanel({ file, onRestored }: FileVersionsPanelProps) {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [currentRevision, setCurrentRevision] = useState(file.revision ?? 1);
  const [retentionLimit, setRetentionLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listFileVersions(file.id);
      setVersions(res.versions);
      setCurrentRevision(res.current_revision);
      setRetentionLimit(res.retention_limit);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [file.id]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const handleDownload = useCallback(
    async (version: FileVersion) => {
      setBusyVersionId(version.id);
      try {
        const dot = file.name.lastIndexOf(".");
        const name =
          dot > 0
            ? `${file.name.slice(0, dot)} (v${version.revision})${file.name.slice(dot)}`
            : `${file.name} (v${version.revision})`;
        await downloadFileVersion(file.id, version.id, name);
      } catch (e) {
        toastError(getErrorMessage(e));
      } finally {
        setBusyVersionId(null);
      }
    },
    [file.id, file.name],
  );

  const handleRestore = useCallback(
    async (version: FileVersion) => {
      setBusyVersionId(version.id);
      try {
        const res = await restoreFileVersion(file.id, version.id);
        toastSuccess(`Restored version ${version.revision}`);
        onRestored?.(res.file);
        await loadVersions();
      } catch (e) {
        toastError(getErrorMessage(e));
      } finally {
        setBusyVersionId(null);
      }
    },
    [file.id, loadVersions, onRestored],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[13px] text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading version history…
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          Current version is <span className="font-semibold text-ink">v{currentRevision}</span>.
        </p>
        {retentionLimit > 0 ? (
          <p className="text-xs text-ink-muted">Keeps the last {retentionLimit} versions</p>
        ) : null}
      </div>

      {versions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg bg-sunken px-4 py-8 text-center">
          <History className="size-5 text-ink-muted" aria-hidden />
          <p className="text-[13px] font-medium text-ink">No earlier versions yet</p>
          <p className="text-xs text-ink-muted">
            Ownly saves the previous contents every time this file is edited.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex items-center justify-between gap-4 border-b border-hairline py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  v{version.revision} · {formatBytes(version.size_bytes)}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {formatFileOpened(version.created_at)} · {originLabel(version)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyVersionId !== null}
                  onClick={() => void handleDownload(version)}
                  aria-label={`Download version ${version.revision}`}
                >
                  <Download className="size-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyVersionId !== null}
                  onClick={() => void handleRestore(version)}
                >
                  {busyVersionId === version.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="size-3.5" aria-hidden />
                  )}
                  Restore
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
