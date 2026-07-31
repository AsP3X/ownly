// Human: Storage node detail panel — overview metrics, indexed media mix, and object-store explorer.
// Agent: CALLS fetchAdminStorageNodeDetail; RENDERS white admin dialog shell; READ-ONLY browse via GET detail.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ChevronRight,
  File,
  FileText,
  Film,
  Folder,
  HardDrive,
  Image,
  Info,
  Loader2,
  Music,
  Server,
  X,
} from "lucide-react";
import {
  fetchAdminStorageNodeDetail,
  getErrorMessage,
  type AdminStorageNodeDetailResponse,
  type AdminStorageNodeRow,
  type MediaCategoryStat,
  type NodeBrowseEntry,
} from "@/api/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  storageNodeStatusLabel,
  storageNodeStatusMeta,
} from "@/lib/storage-node-status";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils-app";

type DetailTab = "overview" | "explore";

/** Human: Used / capacity label with independent byte units for the overview tab. */
function formatStorageUtilizationPair(usedBytes: number, capacityBytes: number | null): string {
  if (capacityBytes != null && capacityBytes > 0) {
    return `${formatBytes(usedBytes)} / ${formatBytes(capacityBytes)}`;
  }
  return formatBytes(usedBytes);
}

const CATEGORY_STYLES: Record<
  string,
  { bar: string; icon: typeof File; iconColor: string }
> = {
  images: { bar: "bg-proc", icon: Image, iconColor: "text-proc" },
  videos: { bar: "bg-brand", icon: Film, iconColor: "text-brand" },
  audio: { bar: "bg-ok", icon: Music, iconColor: "text-ok" },
  documents: { bar: "bg-warn", icon: FileText, iconColor: "text-warn" },
  archives: { bar: "bg-ink-muted", icon: Archive, iconColor: "text-ink-muted" },
  other: { bar: "bg-ink-faint", icon: File, iconColor: "text-ink-faint" },
};

/** Human: Key/value row in the overview tab with optional trailing action. */
function DetailRow({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-col items-start gap-1 sm:items-end">
        <span className="break-all text-sm font-medium text-ink">{value}</span>
        {action}
      </dd>
    </div>
  );
}

/** Human: Skeleton placeholders while node detail loads. */
function DetailOverviewSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="flex justify-between gap-4">
            <div className="h-3 w-24 rounded bg-edge" />
            <div className="h-3 w-40 rounded bg-surface" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-4 w-40 rounded bg-edge" />
        <div className="h-3 w-full max-w-md rounded bg-surface" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="h-3 w-full rounded bg-surface" />
            <div className="h-2 w-full rounded bg-edge" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Human: Horizontal bar for one media category in the indexed library breakdown. */
function MediaCategoryBar({
  row,
  maxBytes,
}: {
  row: MediaCategoryStat;
  maxBytes: number;
}) {
  const style = CATEGORY_STYLES[row.category] ?? CATEGORY_STYLES.other;
  const Icon = style.icon;
  const widthPct = maxBytes > 0 ? Math.max(4, Math.round((row.total_bytes / maxBytes) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <Icon className={cn("size-4", style.iconColor)} aria-hidden />
          {row.label}
        </span>
        <span className="shrink-0 text-ink-muted">
          {row.file_count.toLocaleString()} files · {formatBytes(row.total_bytes)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-edge">
        <div className={cn("h-full rounded-sm transition-[width]", style.bar)} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
}

/** Human: Breadcrumb trail for the object-store prefix explorer — sticky while scrolling. */
function BrowseBreadcrumb({
  prefix,
  onNavigate,
}: {
  prefix: string;
  onNavigate: (nextPrefix: string) => void;
}) {
  const segments = useMemo(() => {
    const trimmed = prefix.replace(/\/$/, "");
    if (!trimmed) return [] as string[];
    return trimmed.split("/").filter(Boolean);
  }, [prefix]);

  return (
    <nav
      className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-1 border-b border-edge bg-panel px-1 pb-3 text-sm text-ink-muted"
      aria-label="Storage path"
    >
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="font-medium text-brand hover:underline"
      >
        Root
      </button>
      {segments.map((segment, index) => {
        const path = `${segments.slice(0, index + 1).join("/")}/`;
        return (
          <span key={path} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5 text-ink-faint" aria-hidden />
            <button
              type="button"
              onClick={() => onNavigate(path)}
              className="font-medium text-brand hover:underline"
            >
              {segment}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function BrowseEntryRow({
  entry,
  onOpenFolder,
}: {
  entry: NodeBrowseEntry;
  onOpenFolder: (prefix: string) => void;
}) {
  const isFolder = entry.kind === "folder";

  return (
    <button
      type="button"
      onClick={() => {
        if (isFolder) onOpenFolder(entry.key);
      }}
      disabled={!isFolder}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
        isFolder ? "hover:bg-surface" : "cursor-default",
      )}
    >
      {isFolder ? (
        <Folder className="size-4 shrink-0 text-warn" aria-hidden />
      ) : (
        <File className="size-4 shrink-0 text-ink-muted" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{entry.name}</span>
      <span className="shrink-0 text-xs text-ink-muted">
        {isFolder
          ? "Folder"
          : entry.size_bytes != null
            ? formatBytes(entry.size_bytes)
            : entry.mime_type ?? "Object"}
      </span>
    </button>
  );
}

/** Human: Detail panel body — loads node detail when open and supports prefix navigation in Explore. */
function AdminStorageNodeDetailSession({
  node,
  initialTab,
}: {
  node: AdminStorageNodeRow;
  initialTab: DetailTab;
}) {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [detail, setDetail] = useState<AdminStorageNodeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [browsePrefix, setBrowsePrefix] = useState("");

  const load = useCallback(
    async (prefix: string, startAfter?: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchAdminStorageNodeDetail(node.id, {
          prefix,
          start_after: startAfter,
        });
        setDetail((prev) => {
          if (startAfter && prev?.browse && response.browse) {
            return {
              ...response,
              browse: {
                ...response.browse,
                entries: [...prev.browse.entries, ...response.browse.entries],
              },
            };
          }
          return response;
        });
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [node.id],
  );

  useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset explorer when node changes
    setTab(initialTab);
    setBrowsePrefix("");
    void load("");
  }, [node.id, initialTab, load]);

  function navigateBrowse(prefix: string) {
    setBrowsePrefix(prefix);
    void load(prefix);
  }

  const maxMediaBytes = useMemo(
    () => Math.max(0, ...(detail?.media_breakdown.map((row) => row.total_bytes) ?? [0])),
    [detail?.media_breakdown],
  );

  const utilizationLabel = formatStorageUtilizationPair(
    node.used_bytes,
    node.target_capacity_bytes,
  );

  return (
    <>
      <div className="flex gap-1 overflow-x-auto border-b border-edge px-4 pt-1 sm:px-6">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "overview"
              ? "border-brand text-brand"
              : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          <Info className="size-4" aria-hidden />
          Overview
        </button>
        <button
          type="button"
          onClick={() => setTab("explore")}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "explore"
              ? "border-brand text-brand"
              : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          <HardDrive className="size-4" aria-hidden />
          Explore storage
        </button>
      </div>

      <div className="max-h-[min(58vh,32rem)] overflow-y-auto px-4 py-5 sm:px-6">
        {loading && !detail ? <DetailOverviewSkeleton /> : null}

        {error ? (
          <p className="rounded-lg border border-danger/40 bg-danger-weak px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {detail && tab === "overview" ? (
          <div className="flex flex-col gap-6">
            <dl className="flex flex-col gap-4">
              <DetailRow label="Node ID" value={detail.node.id} />
              <DetailRow label="Region" value={detail.node.region_label} />
              <DetailRow label="Endpoint" value={detail.node.base_url} />
              <DetailRow label="Status" value={storageNodeStatusLabel(detail.node.status)} />
              <DetailRow
                label="Storage used"
                value={utilizationLabel}
                action={
                  <button
                    type="button"
                    onClick={() => setTab("explore")}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    Browse objects
                  </button>
                }
              />
              <DetailRow
                label="Latency"
                value={detail.node.latency_ms != null ? `${detail.node.latency_ms} ms` : "—"}
              />
              <DetailRow label="Architecture" value={detail.node.storage_mode} />
            </dl>

            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-bold text-ink">Indexed media library</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Instance-wide catalog — breakdown of {detail.indexed_files_total.toLocaleString()}{" "}
                  active files tracked by Ownly across all users. This is not isolated to blobs stored
                  on this endpoint alone.
                </p>
              </div>
              {detail.media_breakdown.length === 0 ? (
                <p className="text-sm text-ink-muted">No indexed files yet.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {detail.media_breakdown.map((row) => (
                    <MediaCategoryBar key={row.category} row={row} maxBytes={maxMediaBytes} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {detail && tab === "explore" ? (
          <div className="flex flex-col gap-4">
            <BrowseBreadcrumb prefix={browsePrefix} onNavigate={(next) => navigateBrowse(next)} />
            {detail.browse_unavailable ? (
              <p className="rounded-lg border border-edge bg-surface px-4 py-3 text-sm text-ink-muted">
                {detail.browse_unavailable}
              </p>
            ) : null}
            {detail.browse && detail.browse.entries.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-edge">
                {detail.browse.entries.map((entry) => (
                  <div key={entry.key} className="border-b border-edge last:border-b-0">
                    <BrowseEntryRow entry={entry} onOpenFolder={navigateBrowse} />
                  </div>
                ))}
              </div>
            ) : null}
            {detail.browse && detail.browse.entries.length === 0 && !detail.browse_unavailable ? (
              <p className="text-sm text-ink-muted">This folder is empty.</p>
            ) : null}
            {detail.browse?.is_truncated && detail.browse.next_start_after ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  void load(browsePrefix, detail.browse?.next_start_after ?? undefined);
                }}
                className="inline-flex items-center gap-2 self-start rounded-lg border border-edge bg-panel px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-surface disabled:opacity-60"
              >
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {loading ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Human: Storage node detail modal — actionable inspection with overview and object browse. */
export function AdminStorageNodeDetailDialog({
  open,
  onOpenChange,
  node,
  initialTab = "overview",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: AdminStorageNodeRow | null;
  initialTab?: DetailTab;
}) {
  function handleClose() {
    onOpenChange(false);
  }

  if (!node) {
    return null;
  }

  const statusMeta = storageNodeStatusMeta(node.status);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
        else onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] w-[calc(100%-1rem)] max-w-[760px] flex-col gap-0 overflow-hidden rounded-2xl border border-edge bg-panel p-0 shadow-[0_12px_32px_-4px_#00000026] sm:w-full"
        overlayClassName="bg-black/30"
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-weak">
              <Server className="size-5 text-brand" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-ink">{node.id}</h2>
              <p className="truncate text-sm text-ink-muted">{node.region_label}</p>
            </div>
            <span
              className={cn(
                "ml-1 hidden shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide sm:inline-flex",
                statusMeta.badgeClass,
              )}
            >
              {storageNodeStatusLabel(node.status)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface"
            aria-label="Close dialog"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <AdminStorageNodeDetailSession key={`${node.id}-${initialTab}`} node={node} initialTab={initialTab} />

        <div className="hidden justify-end border-t border-edge bg-surface/80 px-6 py-4 sm:flex">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-edge bg-panel px-5 py-2.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-surface"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
