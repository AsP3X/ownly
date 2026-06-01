// Human: Storage node detail panel — overview metrics, indexed media mix, and object-store explorer.
// Agent: CALLS fetchAdminStorageNodeDetail; RENDERS white admin dialog shell; READ-ONLY browse via GET detail.

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatBytes } from "@/lib/utils-app";

/** Human: Used / capacity label with independent byte units for the overview tab. */
function formatStorageUtilizationPair(usedBytes: number, capacityBytes: number | null): string {
  if (capacityBytes != null && capacityBytes > 0) {
    return `${formatBytes(usedBytes)} / ${formatBytes(capacityBytes)}`;
  }
  return formatBytes(usedBytes);
}
import { cn } from "@/lib/utils";

type DetailTab = "overview" | "explore";

const CATEGORY_STYLES: Record<
  string,
  { bar: string; icon: typeof File; iconColor: string }
> = {
  images: { bar: "bg-[#8B5CF6]", icon: Image, iconColor: "text-[#8B5CF6]" },
  videos: { bar: "bg-[#2563EB]", icon: Film, iconColor: "text-[#2563EB]" },
  audio: { bar: "bg-[#10B981]", icon: Music, iconColor: "text-[#10B981]" },
  documents: { bar: "bg-[#F59E0B]", icon: FileText, iconColor: "text-[#F59E0B]" },
  archives: { bar: "bg-[#6B7280]", icon: Archive, iconColor: "text-[#6B7280]" },
  other: { bar: "bg-[#9CA3AF]", icon: File, iconColor: "text-[#9CA3AF]" },
};

function statusLabel(status: string): string {
  if (status === "healthy") return "Healthy";
  if (status === "syncing") return "Syncing";
  return "Degraded";
}

function statusBadgeClass(status: string): string {
  if (status === "healthy" || status === "syncing") {
    return "bg-[#ECFDF5] text-[#10B981]";
  }
  return "bg-[#FEF2F2] text-[#EF4444]";
}

/** Human: Key/value row in the overview tab. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-[#666666]">
        {label}
      </dt>
      <dd className="min-w-0 break-all text-sm font-medium text-[#1A1A1A]">{value}</dd>
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
        <span className="inline-flex items-center gap-2 font-medium text-[#1A1A1A]">
          <Icon className={cn("size-4", style.iconColor)} aria-hidden />
          {row.label}
        </span>
        <span className="shrink-0 text-[#666666]">
          {row.file_count.toLocaleString()} files · {formatBytes(row.total_bytes)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-[#E5E7EB]">
        <div className={cn("h-full rounded-sm transition-[width]", style.bar)} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
}

/** Human: Breadcrumb trail for the object-store prefix explorer. */
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
    <nav className="flex flex-wrap items-center gap-1 text-sm text-[#666666]" aria-label="Storage path">
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="font-medium text-[#2563EB] hover:underline"
      >
        Root
      </button>
      {segments.map((segment, index) => {
        const path = `${segments.slice(0, index + 1).join("/")}/`;
        return (
          <span key={path} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5 text-[#9CA3AF]" aria-hidden />
            <button
              type="button"
              onClick={() => onNavigate(path)}
              className="font-medium text-[#2563EB] hover:underline"
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
        isFolder ? "hover:bg-[#F7F8FA]" : "cursor-default",
      )}
    >
      {isFolder ? (
        <Folder className="size-4 shrink-0 text-[#F59E0B]" aria-hidden />
      ) : (
        <File className="size-4 shrink-0 text-[#666666]" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate font-medium text-[#1A1A1A]">{entry.name}</span>
      <span className="shrink-0 text-xs text-[#666666]">
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
function AdminStorageNodeDetailSession({ node }: { node: AdminStorageNodeRow }) {
  const [tab, setTab] = useState<DetailTab>("overview");
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
    setTab("overview");
    setBrowsePrefix("");
    void load("");
  }, [node.id, load]);

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
      <div className="flex gap-1 border-b border-[#E5E7EB] px-6 pt-1">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={cn(
            "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "overview"
              ? "border-[#2563EB] text-[#2563EB]"
              : "border-transparent text-[#666666] hover:text-[#1A1A1A]",
          )}
        >
          <Info className="size-4" aria-hidden />
          Overview
        </button>
        <button
          type="button"
          onClick={() => setTab("explore")}
          className={cn(
            "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "explore"
              ? "border-[#2563EB] text-[#2563EB]"
              : "border-transparent text-[#666666] hover:text-[#1A1A1A]",
          )}
        >
          <HardDrive className="size-4" aria-hidden />
          Explore storage
        </button>
      </div>

      <div className="max-h-[min(58vh,32rem)] overflow-y-auto px-6 py-5">
        {loading && !detail ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#666666]">
            <Loader2 className="size-5 animate-spin text-[#2563EB]" aria-hidden />
            Loading node details…
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        {detail && tab === "overview" ? (
          <div className="flex flex-col gap-6">
            <dl className="flex flex-col gap-4">
              <DetailRow label="Node ID" value={detail.node.id} />
              <DetailRow label="Region" value={detail.node.region_label} />
              <DetailRow label="Endpoint" value={detail.node.base_url} />
              <DetailRow label="Status" value={statusLabel(detail.node.status)} />
              <DetailRow
                label="Storage used"
                value={utilizationLabel}
              />
              <DetailRow
                label="Latency"
                value={detail.node.latency_ms != null ? `${detail.node.latency_ms} ms` : "—"}
              />
              <DetailRow label="Architecture" value={detail.node.storage_mode} />
            </dl>

            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#1A1A1A]">Indexed media library</h3>
                <p className="mt-1 text-sm text-[#666666]">
                  Breakdown of {detail.indexed_files_total.toLocaleString()} active files tracked by Ownly
                  across all users (catalog metadata).
                </p>
              </div>
              {detail.media_breakdown.length === 0 ? (
                <p className="text-sm text-[#666666]">No indexed files yet.</p>
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
            <BrowseBreadcrumb
              prefix={browsePrefix}
              onNavigate={(next) => navigateBrowse(next)}
            />
            {detail.browse_unavailable ? (
              <p className="rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-4 py-3 text-sm text-[#666666]">
                {detail.browse_unavailable}
              </p>
            ) : null}
            {detail.browse && detail.browse.entries.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
                {detail.browse.entries.map((entry) => (
                  <div key={entry.key} className="border-b border-[#E5E7EB] last:border-b-0">
                    <BrowseEntryRow entry={entry} onOpenFolder={navigateBrowse} />
                  </div>
                ))}
              </div>
            ) : null}
            {detail.browse && detail.browse.entries.length === 0 && !detail.browse_unavailable ? (
              <p className="text-sm text-[#666666]">This folder is empty.</p>
            ) : null}
            {detail.browse?.is_truncated && detail.browse.next_start_after ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  void load(browsePrefix, detail.browse?.next_start_after ?? undefined);
                }}
                className="self-start rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#2563EB] transition-colors hover:bg-[#F7F8FA] disabled:opacity-60"
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Human: Storage node detail modal — replaces the mock SSH terminal for actionable inspection. */
export function AdminStorageNodeDetailDialog({
  open,
  onOpenChange,
  node,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: AdminStorageNodeRow | null;
}) {
  function handleClose() {
    onOpenChange(false);
  }

  if (!node) {
    return null;
  }

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
        className="flex max-h-[90vh] w-full max-w-[760px] flex-col gap-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-0 shadow-[0_12px_32px_-4px_#00000026] sm:max-w-[760px]"
        overlayClassName="bg-black/30"
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF]">
              <Server className="size-5 text-[#2563EB]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-[#1A1A1A]">{node.id}</h2>
              <p className="truncate text-sm text-[#666666]">{node.region_label}</p>
            </div>
            <span
              className={cn(
                "ml-1 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                statusBadgeClass(node.status),
              )}
            >
              {statusLabel(node.status)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex size-8 items-center justify-center rounded-full text-[#666666] transition-colors hover:bg-[#F7F8FA]"
            aria-label="Close dialog"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <AdminStorageNodeDetailSession key={node.id} node={node} />

        <div className="flex justify-end border-t border-[#E5E7EB] bg-[#F7F8FA]/80 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA]"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
