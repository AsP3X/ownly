// Human: File picker modal — select files then hand off to the floating upload transfer panel.
// Agent: WRITES startUploadBatch; CLOSES dialog immediately so the drive stays interactive.

import { useCallback, useEffect, useRef, useState, Children, type ReactNode } from "react";
import { FileIcon, Upload, X } from "lucide-react";
import {
  QUEUE_BOX_HEIGHT,
  QUEUE_ROW_HEIGHT,
} from "@/components/drive/upload-batch-view";
import { startUploadBatch, subscribeUploadBatch } from "@/lib/upload-manager";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PendingFile = {
  id: string;
  file: File;
};

function createQueueItemId() {
  return crypto.randomUUID();
}

type UploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
};

// Human: Bordered scroll list for files awaiting upload confirmation in the picker dialog.
function PendingFileListBox({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const hasItems = Children.count(children) > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 bg-[#faf9f8] px-3 py-2">
        <p className="text-xs font-medium text-neutral-600">{title}</p>
      </div>
      <ul
        className="divide-y divide-neutral-100 overflow-y-auto overflow-x-hidden"
        style={{ minHeight: QUEUE_BOX_HEIGHT, maxHeight: QUEUE_BOX_HEIGHT }}
      >
        {hasItems ? (
          children
        ) : (
          <li
            className="flex items-center justify-center px-3 text-sm text-neutral-500"
            style={{ minHeight: QUEUE_BOX_HEIGHT }}
          >
            No files selected yet.
          </li>
        )}
      </ul>
    </div>
  );
}

// Human: Modal to pick files — uploads run in UploadTransferPanel after the user confirms.
// Agent: CALLS startUploadBatch on submit; CLOSES dialog; DOES NOT block drive interaction.
export function UploadDialog({ open, onOpenChange, folderId = null }: UploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [activeUploadBatch, setActiveUploadBatch] = useState(false);

  // Human: Hint when reopening the picker while the corner panel still has work in flight.
  // Agent: SUBSCRIBES upload-manager while open; WRITES activeUploadBatch from batch status.
  useEffect(() => {
    if (!open) return;
    return subscribeUploadBatch((batch) => {
      setActiveUploadBatch(batch?.status === "uploading");
    });
  }, [open]);

  const addPendingFiles = useCallback((selected: FileList | null) => {
    if (!selected?.length) return;
    setPendingFiles((prev) => {
      const incoming = Array.from(selected).map((file) => ({
        id: createQueueItemId(),
        file,
      }));
      return [...prev, ...incoming];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  function removePendingFile(id: string) {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleOpenChange(next: boolean) {
    if (!next) setPendingFiles([]);
    onOpenChange(next);
  }

  // Human: Hand files to upload-manager and close — progress moves to the corner panel.
  // Agent: CALLS startUploadBatch; CLEARS pendingFiles; WRITES onOpenChange(false).
  function handleStartUpload() {
    if (pendingFiles.length === 0) return;
    startUploadBatch(
      pendingFiles.map((item) => item.file),
      folderId,
    );
    setPendingFiles([]);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-full max-w-[min(32rem,calc(100%-2rem))] gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-lg">
        <DialogHeader className="min-w-0 border-b border-neutral-100 px-5 py-4 pr-12">
          <DialogTitle className="truncate text-base font-semibold text-neutral-900">
            Upload files
          </DialogTitle>
          <DialogDescription className="text-sm text-neutral-500">
            Choose files to add to your library. Upload progress appears in the panel at the
            bottom-right so you can keep browsing.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => addPendingFiles(event.target.files)}
        />

        <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
          {activeUploadBatch ? (
            <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Uploads are running in the panel at the bottom-right. Files you add here join the
              same queue.
            </p>
          ) : null}

          <button
            type="button"
            onClick={openFilePicker}
            className={cn(
              "flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-[#faf9f8] px-4 py-5 text-center transition",
              "hover:border-blue-400 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
            )}
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-blue-100">
              <Upload className="size-4 text-blue-600" aria-hidden />
            </div>
            <span className="text-sm font-medium text-neutral-900">Browse files</span>
            <span className="text-xs text-neutral-500">Single or multiple files</span>
          </button>

          {pendingFiles.length > 0 ? (
            <PendingFileListBox title={`Selected · ${pendingFiles.length}`}>
              {pendingFiles.map((item) => (
                <li
                  key={item.id}
                  className="flex h-[var(--upload-queue-row-height)] min-h-[var(--upload-queue-row-height)] items-center gap-2.5 px-3"
                  style={{ ["--upload-queue-row-height" as string]: QUEUE_ROW_HEIGHT }}
                >
                  <FileIcon className="size-3.5 shrink-0 text-blue-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-900">{item.file.name}</p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
                    {formatBytes(item.file.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0 text-neutral-400 hover:text-red-600"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removePendingFile(item.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </PendingFileListBox>
          ) : null}
        </div>

        <DialogFooter className="min-w-0 w-full shrink-0 flex-row justify-end gap-2 border-t border-neutral-100 bg-neutral-50/80 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={pendingFiles.length === 0}
            onClick={handleStartUpload}
          >
            Upload {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
