// Human: Details modal for a file or folder — metadata tab plus share link management tab.
// Agent: READS FileItem/FolderItem; RENDERS ShareLinksPanel on Sharing tab; CALLS onShareChanged on revoke/create.

import { useState } from "react";
import { FileIcon, Folder, Info, Link2 } from "lucide-react";
import type { FileItem, FolderItem } from "@/api/client";
import { ShareLinksPanel } from "@/components/drive/ShareLinksPanel";
import type { ShareTarget } from "@/components/drive/ShareDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatFileOpened } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

export type DetailsTarget =
  | { kind: "file"; file: FileItem }
  | { kind: "folder"; folder: FolderItem };

type ResourceDetailsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DetailsTarget | null;
  initialTab?: "details" | "sharing";
  onShareChanged?: () => void;
};

type DetailsTab = "details" | "sharing";

function toShareTarget(target: DetailsTarget): ShareTarget {
  if (target.kind === "file") {
    return {
      resource_type: "file",
      resource_id: target.file.id,
      name: target.file.name,
    };
  }
  return {
    resource_type: "folder",
    resource_id: target.folder.id,
    name: target.folder.name,
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="min-w-0 break-all text-sm text-neutral-900">{value}</dd>
    </div>
  );
}

export function ResourceDetailsDialog({
  open,
  onOpenChange,
  target,
  initialTab = "details",
  onShareChanged,
}: ResourceDetailsDialogProps) {
  const [tab, setTab] = useState<DetailsTab>(initialTab);

  function handleOpenChange(next: boolean) {
    if (next) {
      setTab(initialTab);
    }
    onOpenChange(next);
  }

  const name = target?.kind === "file" ? target.file.name : target?.folder.name;
  const isFile = target?.kind === "file";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-lg">
        <DialogHeader className="min-w-0 border-b border-neutral-100 px-6 py-5 pr-12">
          <div className="flex min-w-0 items-start gap-3">
            {isFile ? (
              <FileIcon className="mt-0.5 size-5 shrink-0 text-sky-600" />
            ) : (
              <Folder className="mt-0.5 size-5 shrink-0 text-amber-500" />
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg text-neutral-900">{name ?? "Details"}</DialogTitle>
              <DialogDescription className="text-neutral-500">
                {isFile ? "File properties and sharing" : "Folder properties and sharing"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex gap-1 border-b border-neutral-100 px-6 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "rounded-b-none border-b-2 border-transparent",
              tab === "details" && "border-blue-600 text-blue-700",
            )}
            onClick={() => setTab("details")}
          >
            <Info className="size-4" />
            Details
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "rounded-b-none border-b-2 border-transparent",
              tab === "sharing" && "border-blue-600 text-blue-700",
            )}
            onClick={() => setTab("sharing")}
          >
            <Link2 className="size-4" />
            Sharing
          </Button>
        </div>

        <div className="max-h-[min(60vh,28rem)] overflow-y-auto px-6 py-5">
          {!target ? null : tab === "details" ? (
            <dl className="flex flex-col gap-4">
              {target.kind === "file" ? (
                <>
                  <DetailRow label="Name" value={target.file.name} />
                  <DetailRow label="Size" value={formatBytes(target.file.size_bytes)} />
                  <DetailRow label="Type" value={target.file.mime_type ?? "Unknown"} />
                  <DetailRow label="Modified" value={formatFileOpened(target.file.updated_at)} />
                  <DetailRow label="Created" value={formatFileOpened(target.file.created_at)} />
                  {target.file.mime_type?.startsWith("video/") ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Video
                      </span>
                      <Badge variant="secondary">
                        {target.file.hls_ready ? "Ready to stream" : "Processing"}
                      </Badge>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <DetailRow label="Name" value={target.folder.name} />
                  <DetailRow label="Modified" value={formatFileOpened(target.folder.updated_at)} />
                  <DetailRow label="Created" value={formatFileOpened(target.folder.created_at)} />
                  <DetailRow label="Kind" value="Folder" />
                </>
              )}
            </dl>
          ) : (
            <ShareLinksPanel target={toShareTarget(target)} onChanged={onShareChanged} />
          )}
        </div>

        <div className="flex justify-end border-t border-neutral-100 bg-neutral-50/80 px-6 py-4">
          <Button type="button" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
