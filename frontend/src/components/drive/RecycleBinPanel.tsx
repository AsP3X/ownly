// Human: Recycle bin view — restore items or permanently delete with the same blob-progress dialogs as the drive.
// Agent: READS recycle-bin list from parent; OPENS ConfirmDeleteDialog / ConfirmBulkDeleteDialog for permanent purge.

import { useState } from "react";
import { Folder, RotateCcw, Trash2 } from "lucide-react";
import {
  emptyRecycleBin,
  fetchFolderDeletionPreview,
  fetchRecycleBinDeletionPreview,
  getErrorMessage,
  restoreRecycleBinItems,
  type FolderDeletionPreview,
  type RecycleBinFileItem,
  type RecycleBinFolderItem,
  type RecycleBinResponse,
} from "@/api/client";
import { ConfirmBulkDeleteDialog } from "@/components/drive/ConfirmBulkDeleteDialog";
import {
  ConfirmDeleteDialog,
  type DeleteTarget,
} from "@/components/drive/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatBytes } from "@/lib/utils-app";

type RecycleBinPanelProps = {
  data: RecycleBinResponse | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onChanged?: () => void;
};

type RecycleRow =
  | { kind: "file"; item: RecycleBinFileItem }
  | { kind: "folder"; item: RecycleBinFolderItem };

// Human: Format an ISO timestamp for the deleted-on column.
// Agent: READS deleted_at string; RETURNS locale date + time.
function formatDeletedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Human: Days remaining before the server auto-purges a recycle bin item.
// Agent: READS expires_at; RETURNS floored day count (minimum 0).
function daysUntilExpiry(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return 30;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// Human: Render the recycle bin table and wire permanent deletes to shared confirmation dialogs.
// Agent: WRITES deleteTarget / bulkDeleteItems; FETCHES folder + empty-bin previews before opening dialogs.
export function RecycleBinPanel({
  data,
  loading,
  error,
  onRefresh,
  onChanged,
}: RecycleBinPanelProps) {
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [folderPreview, setFolderPreview] = useState<FolderDeletionPreview | null>(null);
  const [folderPreviewLoading, setFolderPreviewLoading] = useState(false);
  const [folderPreviewError, setFolderPreviewError] = useState("");
  const [emptyBinOpen, setEmptyBinOpen] = useState(false);
  const [emptyBinFileCount, setEmptyBinFileCount] = useState(0);
  const [emptyBinLoading, setEmptyBinLoading] = useState(false);
  const [emptyBinError, setEmptyBinError] = useState("");

  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const rows: RecycleRow[] = [
    ...folders.map((item) => ({ kind: "folder" as const, item })),
    ...files.map((item) => ({ kind: "file" as const, item })),
  ].sort((a, b) => new Date(b.item.deleted_at).getTime() - new Date(a.item.deleted_at).getTime());

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setFolderPreview(null);
    setFolderPreviewLoading(false);
    setFolderPreviewError("");
  }

  function handlePermanentDeleted() {
    onRefresh();
    onChanged?.();
  }

  async function handleRestore(row: RecycleRow) {
    setBusyId(row.item.id);
    setActionError("");
    try {
      await restoreRecycleBinItems({
        file_ids: row.kind === "file" ? [row.item.id] : [],
        folder_ids: row.kind === "folder" ? [row.item.id] : [],
      });
      onRefresh();
      onChanged?.();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function requestPermanentDeleteFile(row: RecycleRow & { kind: "file" }) {
    setActionError("");
    setDeleteTarget({ kind: "file", id: row.item.id, name: row.item.name });
  }

  async function requestPermanentDeleteFolder(row: RecycleRow & { kind: "folder" }) {
    setActionError("");
    setFolderPreview(null);
    setFolderPreviewError("");
    setFolderPreviewLoading(true);
    setDeleteTarget({ kind: "folder", id: row.item.id, name: row.item.name });

    try {
      const preview = await fetchFolderDeletionPreview(row.item.id);
      setFolderPreview(preview);
    } catch (err) {
      setFolderPreviewError(getErrorMessage(err));
    } finally {
      setFolderPreviewLoading(false);
    }
  }

  async function requestEmptyBin() {
    setEmptyBinError("");
    setEmptyBinLoading(true);
    try {
      const preview = await fetchRecycleBinDeletionPreview();
      // Human: Preview omits per-file rows for large bins — use file_count, not files.length.
      // Agent: WHEN file_count is 0, only folders remain; skip dialog and purge synchronously.
      if (preview.file_count === 0) {
        await emptyRecycleBin();
        onRefresh();
        onChanged?.();
        return;
      }
      setEmptyBinFileCount(preview.file_count);
      setEmptyBinOpen(true);
    } catch (err) {
      setEmptyBinError(getErrorMessage(err));
    } finally {
      setEmptyBinLoading(false);
    }
  }

  const displayError = actionError || error || emptyBinError;

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-600">
            Items are removed automatically after 30 days. Restore files and folders before they
            expire.
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={loading || rows.length === 0 || emptyBinLoading}
            onClick={() => void requestEmptyBin()}
          >
            <Trash2 data-icon="inline-start" />
            {emptyBinLoading ? "Checking…" : "Empty recycle bin"}
          </Button>
        </div>

        {displayError ? (
          <Alert variant="destructive">
            <AlertDescription>{displayError}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-neutral-500">Loading recycle bin…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/80 px-6 py-12 text-center">
            <Trash2 className="mx-auto mb-3 size-8 text-neutral-400" aria-hidden />
            <p className="text-sm font-medium text-neutral-800">Recycle bin is empty</p>
            <p className="mt-1 text-sm text-neutral-500">
              Deleted files and folders will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Original location</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Deleted</th>
                  <th className="px-4 py-3 font-medium">Expires in</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {rows.map((row) => {
                  const isFolder = row.kind === "folder";
                  const name = row.item.name;
                  const location =
                    row.kind === "file"
                      ? (row.item.folder_name ?? "My files")
                      : "Folder";
                  const sizeLabel =
                    row.kind === "file" ? formatBytes(row.item.size_bytes) : null;
                  const fileCount =
                    row.kind === "folder" ? row.item.file_count : null;

                  return (
                    <tr key={`${row.kind}-${row.item.id}`} className="text-neutral-800">
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {isFolder ? (
                            <Folder className="size-4 shrink-0 text-amber-600" aria-hidden />
                          ) : (
                            <Trash2 className="size-4 shrink-0 text-neutral-400" aria-hidden />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium" title={name}>
                              {name}
                            </p>
                            <p className="text-xs text-neutral-500 md:hidden">
                              {location}
                              {sizeLabel ? ` · ${sizeLabel}` : null}
                              {fileCount !== null && fileCount > 0
                                ? ` · ${fileCount} file${fileCount === 1 ? "" : "s"}`
                                : null}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-neutral-600 md:table-cell">
                        {location}
                        {fileCount !== null && fileCount > 0 ? (
                          <span className="text-neutral-400">
                            {" "}
                            · {fileCount} file{fileCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden px-4 py-3 text-neutral-600 sm:table-cell">
                        {formatDeletedAt(row.item.deleted_at)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-neutral-600">
                        {daysUntilExpiry(row.item.expires_at)} days
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.item.id}
                            onClick={() => void handleRestore(row)}
                          >
                            <RotateCcw data-icon="inline-start" />
                            Restore
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={busyId === row.item.id}
                            onClick={() =>
                              row.kind === "file"
                                ? requestPermanentDeleteFile(row)
                                : void requestPermanentDeleteFolder(row)
                            }
                          >
                            Delete permanently
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
        target={deleteTarget}
        folderPreview={folderPreview}
        folderPreviewLoading={folderPreviewLoading}
        folderPreviewError={folderPreviewError}
        variant="recycle-bin-permanent"
        onDeleted={handlePermanentDeleted}
      />

      <ConfirmBulkDeleteDialog
        open={emptyBinOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEmptyBinOpen(false);
            setEmptyBinFileCount(0);
          }
        }}
        items={[]}
        recycleBinEmpty
        variant="permanent-only"
        title="Empty recycle bin?"
        description={`All ${emptyBinFileCount} file${
          emptyBinFileCount === 1 ? "" : "s"
        } in the recycle bin will be permanently removed. This cannot be undone.`}
        onPermanentComplete={async () => {
          await emptyRecycleBin();
        }}
        onDeleted={() => {
          handlePermanentDeleted();
        }}
      />
    </>
  );
}
