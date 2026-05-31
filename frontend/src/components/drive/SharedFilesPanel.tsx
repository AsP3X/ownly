// Human: Shared Files drive view — Pencil "Ownly Shared Files" wireframes (with-me + by-me tabs).
// Agent: CALLS fetchSharedWithMe/fetchSharedByMe; EMITS onManageShare/onShareNavigate; Tailwind-only layout.

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Search,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  downloadGrantedFile,
  getErrorMessage,
  leaveSharedWithMe,
  publicSharePageUrl,
  type SharedByMeItem,
  type SharedByMeMetrics,
  type SharedWithMeItem,
} from "@/api/client";
import type { ShareTarget } from "@/components/drive/ShareDialog";
import {
  avatarPaletteForEmail,
  formatSharedCalendarDate,
  formatSharedRelativeDate,
  sharedFolderIconColor,
  sharedPersonName,
  sharedWithMeIconColor,
  stackAvatarColor,
} from "@/lib/shared-files-format";
import { copyTextToClipboard, formatBytes, userInitials } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type SharedFilesTab = "with-me" | "by-me";
type ResourceFilter = "all" | "files" | "folders";

type SharedFilesPanelProps = {
  withMeItems: SharedWithMeItem[];
  byMeItems: SharedByMeItem[];
  byMeMetrics: SharedByMeMetrics | null;
  loadingWithMe: boolean;
  loadingByMe: boolean;
  error: string;
  onShareNavigate: () => void;
  onManageShare: (target: ShareTarget) => void;
  onRefreshWithMe: () => void;
  onPreviewGrantedFile?: (item: SharedWithMeItem) => void;
};

// Human: Tab row with bottom accent bar — active tab uses #2563EB semibold + 2px underline.
// Agent: RENDERS two tabs; WRITES active tab via onSelect.
function SharedFilesTabs({
  activeTab,
  onSelect,
}: {
  activeTab: SharedFilesTab;
  onSelect: (tab: SharedFilesTab) => void;
}) {
  const tabs: { id: SharedFilesTab; label: string }[] = [
    { id: "with-me", label: "Shared with me" },
    { id: "by-me", label: "Shared by me" },
  ];

  return (
    <div className="flex gap-8 border-b border-[#E5E7EB]" role="tablist" aria-label="Shared files views">
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "flex w-[140px] flex-col items-center gap-3 px-2 pb-3 pt-0 text-[15px] transition-colors",
              active ? "font-semibold text-[#2563EB]" : "font-normal text-[#666666] hover:text-[#1A1A1A]",
            )}
            onClick={() => onSelect(tab.id)}
          >
            <span>{tab.label}</span>
            <span className={cn("h-0.5 w-full rounded-full", active ? "bg-[#2563EB]" : "bg-transparent")} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

// Human: Permission pill — Can Edit (blue) or Can View (gray) per Pencil table rows.
// Agent: READS permission string; RENDERS icon + label inside rounded-full badge.
function PermissionBadge({ permission }: { permission: SharedWithMeItem["permission"] }) {
  const canEdit = permission === "edit";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-xs font-medium",
        canEdit ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#F3F4F6] text-[#4B5563]",
      )}
    >
      {canEdit ? (
        <Pencil className="size-3 shrink-0" aria-hidden />
      ) : (
        <Eye className="size-3 shrink-0" aria-hidden />
      )}
      {canEdit ? "Can Edit" : "Can View"}
    </span>
  );
}

// Human: Owner avatar + name + email stack for Shared with me rows.
// Agent: READS owner_email; RENDERS 32px initials circle + two-line label.
function SharedByOwnerCell({ email }: { email: string }) {
  const palette = avatarPaletteForEmail(email);
  const name = sharedPersonName(email);
  const initials = userInitials(email);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          palette.bg,
          palette.text,
        )}
      >
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[#1A1A1A]">{name}</p>
        <p className="truncate text-xs text-[#666666]">{email}</p>
      </div>
    </div>
  );
}

// Human: Mime/folder icon for Shared with me name column — colored lucide at 20px.
// Agent: READS resource_type + mime_type; PICKS icon component + hex fill.
function SharedWithMeResourceIcon({
  item,
}: {
  item: Pick<SharedWithMeItem, "resource_type" | "mime_type" | "name">;
}) {
  const isFolder = item.resource_type === "folder";
  const color = isFolder
    ? sharedFolderIconColor(item.name)
    : sharedWithMeIconColor(item.mime_type, false);
  const mime = (item.mime_type ?? "").toLowerCase();

  let Icon = FileText;
  if (isFolder) Icon = Folder;
  else if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) Icon = FileSpreadsheet;
  else if (mime.includes("pdf") || mime.startsWith("text/")) Icon = FileText;

  return <Icon className="size-5 shrink-0" style={{ color }} aria-hidden />;
}

// Human: Context menu for Shared with me row actions — matches Pencil popover items.
// Agent: RENDERS absolute panel; CALLS preview/download/leave handlers.
function SharedWithMeRowMenu({
  open,
  onClose,
  onPreview,
  onDownload,
  onLeave,
}: {
  open: boolean;
  onClose: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onLeave: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={onClose} />
      <div
        className="absolute right-5 top-full z-50 mt-1 w-[230px] rounded-lg border border-[#E5E7EB] bg-white p-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.12)]"
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg bg-[#F7F8FA] px-3 py-2 text-[13px] font-semibold text-[#2563EB]"
          onClick={() => {
            onPreview();
            onClose();
          }}
        >
          <ExternalLink className="size-4 shrink-0" aria-hidden />
          Open / Preview
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#666666] hover:bg-[#F7F8FA]"
          onClick={() => {
            onDownload();
            onClose();
          }}
        >
          <Download className="size-4 shrink-0" aria-hidden />
          Download
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#666666] hover:bg-[#F7F8FA]"
          onClick={onClose}
        >
          <FolderPlus className="size-4 shrink-0" aria-hidden />
          Add shortcut to My Cloud
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#666666] hover:bg-[#F7F8FA]"
          onClick={onClose}
        >
          <Link2 className="size-4 shrink-0" aria-hidden />
          Copy Link
        </button>
        <div className="py-2">
          <div className="h-px bg-[#E5E7EB]" />
        </div>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#EF4444] hover:bg-[#FEF2F2]"
          onClick={() => {
            onLeave();
            onClose();
          }}
        >
          <Trash2 className="size-4 shrink-0" aria-hidden />
          Remove from Shared
        </button>
      </div>
    </>
  );
}

// Human: Shared with me table — fixed column layout from Pencil (Name 340, Shared By 320, etc.).
// Agent: CLIENT-FILTERS items; RENDERS search + filter bar above bordered table card.
function SharedWithMeTable({
  items,
  loading,
  onPreview,
  onRefresh,
}: {
  items: SharedWithMeItem[];
  loading: boolean;
  onPreview: (item: SharedWithMeItem) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "files" && item.resource_type !== "file") return false;
      if (filter === "folders" && item.resource_type !== "folder") return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.owner_email.toLowerCase().includes(q) ||
        sharedPersonName(item.owner_email).toLowerCase().includes(q)
      );
    });
  }, [filter, items, query]);

  const handleDownload = useCallback(async (item: SharedWithMeItem) => {
    if (item.resource_type !== "file") return;
    setActionError("");
    try {
      await downloadGrantedFile(item.resource_id, item.name);
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  }, []);

  const handleLeave = useCallback(
    async (item: SharedWithMeItem) => {
      setActionError("");
      try {
        await leaveSharedWithMe(item.id);
        onRefresh();
      } catch (err) {
        setActionError(getErrorMessage(err));
      }
    },
    [onRefresh],
  );

  const filterLabel =
    filter === "all" ? "Filters" : filter === "files" ? "Files only" : "Folders only";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <label className="relative block w-full max-w-[320px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#666666]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shared files..."
            className="h-10 w-full rounded-lg border border-[#E5E7EB] bg-white py-0 pl-10 pr-3.5 text-sm text-[#1A1A1A] placeholder:text-[#888888] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
            aria-label="Search shared files"
          />
        </label>

        <div className="relative">
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-sm font-medium text-[#666666] hover:bg-[#F7F8FA]"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            {filterLabel}
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
          {filterOpen ? (
            <>
              <button type="button" className="fixed inset-0 z-30" aria-label="Close filters" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg border border-[#E5E7EB] bg-white p-1 shadow-lg">
                {(
                  [
                    ["all", "All items"],
                    ["files", "Files only"],
                    ["folders", "Folders only"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      "flex w-full rounded-md px-3 py-2 text-left text-sm",
                      filter === value ? "bg-[#EFF6FF] font-medium text-[#2563EB]" : "text-[#666666] hover:bg-[#F7F8FA]",
                    )}
                    onClick={() => {
                      setFilter(value);
                      setFilterOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {actionError ? <p className="text-sm text-[#EF4444]">{actionError}</p> : null}

      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
        <div className="hidden min-w-[1080px] lg:block">
          <div className="flex h-12 items-center border-b border-[#E5E7EB] bg-[#F7F8FA] text-xs font-semibold text-[#666666]">
            <div className="w-[340px] shrink-0 px-5">Name</div>
            <div className="w-[320px] shrink-0 px-5">Shared By</div>
            <div className="w-[150px] shrink-0 px-5">Date Shared</div>
            <div className="w-[150px] shrink-0 px-5">Permissions</div>
            <div className="w-[120px] shrink-0 px-5">Actions</div>
          </div>

          {loading ? (
            <p className="px-5 py-12 text-center text-sm text-[#666666]">Loading shared files…</p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-[#666666]">No shared files yet.</p>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="relative flex h-[68px] items-center border-b border-[#E5E7EB] last:border-b-0"
              >
                <div className="flex w-[340px] shrink-0 items-center gap-3 px-5">
                  <SharedWithMeResourceIcon item={item} />
                  <span className="truncate text-sm font-medium text-[#1A1A1A]">{item.name}</span>
                </div>
                <div className="w-[320px] shrink-0 px-5">
                  <SharedByOwnerCell email={item.owner_email} />
                </div>
                <div className="w-[150px] shrink-0 px-5 text-sm text-[#666666]">
                  {formatSharedCalendarDate(item.shared_at)}
                </div>
                <div className="w-[150px] shrink-0 px-5">
                  <PermissionBadge permission={item.permission} />
                </div>
                <div className="relative flex w-[120px] shrink-0 items-center gap-4 px-5">
                  <button
                    type="button"
                    className="text-[#666666] transition hover:text-[#1A1A1A]"
                    aria-label={`Preview ${item.name}`}
                    onClick={() => onPreview(item)}
                  >
                    <Eye className="size-[18px]" />
                  </button>
                  <button
                    type="button"
                    className="text-[#666666] transition hover:text-[#1A1A1A] disabled:opacity-40"
                    aria-label={`Download ${item.name}`}
                    disabled={item.resource_type !== "file"}
                    onClick={() => void handleDownload(item)}
                  >
                    <Download className="size-[18px]" />
                  </button>
                  <button
                    type="button"
                    className="text-[#666666] transition hover:text-[#1A1A1A]"
                    aria-label={`More actions for ${item.name}`}
                    onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                  >
                    <MoreHorizontal className="size-[18px]" />
                  </button>
                  <SharedWithMeRowMenu
                    open={openMenuId === item.id}
                    onClose={() => setOpenMenuId(null)}
                    onPreview={() => onPreview(item)}
                    onDownload={() => void handleDownload(item)}
                    onLeave={() => void handleLeave(item)}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Human: Stacked cards below lg — same data, touch-friendly row actions. */}
        {/* Agent: RENDERS mobile list when desktop table is hidden. */}
        <div className="divide-y divide-[#E5E7EB] lg:hidden">
          {loading ? (
            <p className="px-4 py-10 text-center text-sm text-[#666666]">Loading shared files…</p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[#666666]">No shared files yet.</p>
          ) : (
            filtered.map((item) => (
              <div key={item.id} className="flex flex-col gap-3 px-4 py-4">
                <div className="flex items-start gap-3">
                  <SharedWithMeResourceIcon item={item} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#1A1A1A]">{item.name}</p>
                    <p className="mt-1 text-xs text-[#666666]">{formatSharedCalendarDate(item.shared_at)}</p>
                  </div>
                  <PermissionBadge permission={item.permission} />
                </div>
                <SharedByOwnerCell email={item.owner_email} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#666666]"
                    onClick={() => onPreview(item)}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#666666] disabled:opacity-40"
                    disabled={item.resource_type !== "file"}
                    onClick={() => void handleDownload(item)}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#EF4444]/30 px-3 py-1.5 text-xs font-medium text-[#EF4444]"
                    onClick={() => void handleLeave(item)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Human: KPI card on Shared by me tab — label, icon badge, value, green trend footer.
// Agent: RENDERS metric tile matching Pencil card dimensions and typography.
function SharedByMeMetricCard({
  label,
  value,
  footer,
  icon,
  iconWrapClass,
}: {
  label: string;
  value: string;
  footer: string;
  icon: React.ReactNode;
  iconWrapClass: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-[#666666]">{label}</p>
        <span className={cn("flex size-8 items-center justify-center rounded-full", iconWrapClass)}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-[#1A1A1A]">{value}</p>
      <div className="flex items-center gap-1 text-xs font-semibold text-[#10B981]">
        <TrendingUp className="size-3.5" aria-hidden />
        {footer}
      </div>
    </div>
  );
}

// Human: Link sharing status cell — Public Link, Password Protected, or Restricted.
// Agent: READS public_share row; RENDERS icon + colored label per Pencil variants.
function LinkSharingCell({ item }: { item: SharedByMeItem }) {
  const share = item.public_share;
  if (!share) {
    return (
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#666666]">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        Restricted
      </div>
    );
  }
  if (share.requires_password) {
    return (
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#10B981]">
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
        Password Protected
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[13px] font-semibold text-[#2563EB]">
      <Globe className="size-3.5 shrink-0" aria-hidden />
      Public Link
    </div>
  );
}

// Human: Shared With column — avatar stack + count or "Anyone with link" copy.
// Agent: READS grantees + public_share; RENDERS overlapping initials or public label.
function SharedWithCell({ item }: { item: SharedByMeItem }) {
  if (item.public_share && item.grantees.length === 0) {
    return <span className="text-[13px] text-[#666666]">Anyone with link</span>;
  }

  const visible = item.grantees.slice(0, 2);
  const remainder = item.grantees.length - visible.length;
  const countLabel =
    remainder > 0
      ? `+${remainder} others`
      : item.grantees.length === 1
        ? "1 person"
        : `${item.grantees.length} people`;

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-6 w-12 shrink-0">
        {visible.map((grantee, index) => (
          <span
            key={grantee.id}
            className={cn(
              "absolute top-0 flex size-6 items-center justify-center rounded-full text-[9px] font-bold text-white",
              stackAvatarColor(index),
            )}
            style={{ left: index * 16 }}
          >
            {userInitials(grantee.email)}
          </span>
        ))}
      </div>
      <span className="text-[13px] text-[#666666]">{countLabel}</span>
    </div>
  );
}

// Human: Shared by me table inside padded card — Active Shares title + Filter & Sort control.
// Agent: RENDERS metric cards above; MAPS items to grid rows with Manage + Copy actions.
function SharedByMeSection({
  items,
  metrics,
  loading,
  onManage,
}: {
  items: SharedByMeItem[];
  metrics: SharedByMeMetrics | null;
  loading: boolean;
  onManage: (item: SharedByMeItem) => void;
}) {
  const [copyNotice, setCopyNotice] = useState("");

  const handleCopyLink = useCallback(async (item: SharedByMeItem) => {
    if (!item.public_share) return;
    try {
      await copyTextToClipboard(publicSharePageUrl(item.public_share.token));
      setCopyNotice("Link copied");
      window.setTimeout(() => setCopyNotice(""), 2000);
    } catch {
      setCopyNotice("Could not copy link");
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        <SharedByMeMetricCard
          label="Active Shared Links"
          value={`${metrics?.active_links ?? 0} Links`}
          footer={
            metrics && metrics.active_links > 0 ? `${metrics.active_links} active` : "No links yet"
          }
          icon={<Link2 className="size-4 text-[#2563EB]" aria-hidden />}
          iconWrapClass="bg-black"
        />
        <SharedByMeMetricCard
          label="External Collaborators"
          value={`${metrics?.collaborators ?? 0} People`}
          footer={
            metrics && metrics.collaborators > 0
              ? `${metrics.collaborators} invited`
              : "No collaborators yet"
          }
          icon={<Users className="size-4 text-[#10B981]" aria-hidden />}
          iconWrapClass="bg-[#10B98120]"
        />
        <SharedByMeMetricCard
          label="Total Link Views"
          value={`${(metrics?.total_views ?? 0).toLocaleString()} Times`}
          footer="View tracking coming soon"
          icon={<Eye className="size-4 text-[#F59E0B]" aria-hidden />}
          iconWrapClass="bg-[#F59E0B20]"
        />
      </div>

      {copyNotice ? <p className="text-sm font-medium text-[#2563EB]">{copyNotice}</p> : null}

      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-[#1A1A1A]">Active Shares</h2>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px] font-semibold text-[#666666] hover:bg-[#F7F8FA]"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Filter &amp; Sort
          </button>
        </div>

        <div className="hidden min-w-[1084px] lg:block">
          <div className="flex border-b border-[#E5E7EB] py-2 text-xs font-bold text-[#888888]">
            <div className="w-[320px] shrink-0">Name</div>
            <div className="w-[220px] shrink-0">Shared With</div>
            <div className="w-[180px] shrink-0">Link Sharing</div>
            <div className="w-[120px] shrink-0">Views</div>
            <div className="w-[120px] shrink-0">Date Shared</div>
            <div className="w-[124px] shrink-0 text-right">Actions</div>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-[#666666]">Loading your shares…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#666666]">You have not shared anything yet.</p>
          ) : (
            items.map((item) => (
              <div
                key={`${item.resource_type}-${item.resource_id}`}
                className="flex items-center border-b border-[#E5E7EB] py-3 last:border-b-0"
              >
                <div className="flex w-[320px] shrink-0 items-center gap-3">
                  {item.resource_type === "folder" ? (
                    <Folder className="size-[18px] shrink-0 text-[#F59E0B]" aria-hidden />
                  ) : (
                    <File className="size-[18px] shrink-0 text-[#2563EB]" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#1A1A1A]">{item.name}</p>
                    <p className="text-xs text-[#888888]">
                      {item.resource_type === "folder" && item.size_bytes <= 0
                        ? "Folder"
                        : formatBytes(item.size_bytes)}
                    </p>
                  </div>
                </div>
                <div className="w-[220px] shrink-0">
                  <SharedWithCell item={item} />
                </div>
                <div className="w-[180px] shrink-0">
                  <LinkSharingCell item={item} />
                </div>
                <div className="w-[120px] shrink-0 text-sm text-[#666666]">
                  {item.view_count.toLocaleString()} views
                </div>
                <div className="w-[120px] shrink-0 text-sm text-[#666666]">
                  {formatSharedRelativeDate(item.shared_at)}
                </div>
                <div className="flex w-[124px] shrink-0 items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-[#F7F8FA] p-1.5 text-[#666666] hover:text-[#1A1A1A] disabled:opacity-40"
                    aria-label={`Copy link for ${item.name}`}
                    disabled={!item.public_share}
                    onClick={() => void handleCopyLink(item)}
                  >
                    <Copy className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-semibold text-[#1A1A1A] hover:bg-[#F7F8FA]"
                    onClick={() => onManage(item)}
                  >
                    Manage
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="divide-y divide-[#E5E7EB] lg:hidden">
          {loading ? (
            <p className="py-10 text-center text-sm text-[#666666]">Loading your shares…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#666666]">You have not shared anything yet.</p>
          ) : (
            items.map((item) => (
              <div key={`${item.resource_type}-${item.resource_id}`} className="flex flex-col gap-3 py-4">
                <div className="flex items-start gap-3">
                  {item.resource_type === "folder" ? (
                    <Folder className="size-5 shrink-0 text-[#F59E0B]" aria-hidden />
                  ) : (
                    <File className="size-5 shrink-0 text-[#2563EB]" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#1A1A1A]">{item.name}</p>
                    <p className="text-xs text-[#888888]">{formatSharedRelativeDate(item.shared_at)}</p>
                  </div>
                </div>
                <SharedWithCell item={item} />
                <LinkSharingCell item={item} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-semibold text-[#1A1A1A] disabled:opacity-40"
                    disabled={!item.public_share}
                    onClick={() => void handleCopyLink(item)}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={() => onManage(item)}
                  >
                    Manage
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Human: Shared Files main panel — header, tabs, and tab-specific tables per Pencil wireframes. */
export function SharedFilesPanel({
  withMeItems,
  byMeItems,
  byMeMetrics,
  loadingWithMe,
  loadingByMe,
  error,
  onShareNavigate,
  onManageShare,
  onRefreshWithMe,
  onPreviewGrantedFile,
}: SharedFilesPanelProps) {
  const [activeTab, setActiveTab] = useState<SharedFilesTab>("with-me");

  const handleManage = useCallback(
    (item: SharedByMeItem) => {
      onManageShare({
        resource_type: item.resource_type,
        resource_id: item.resource_id,
        name: item.name,
      });
    },
    [onManageShare],
  );

  const handlePreview = useCallback(
    (item: SharedWithMeItem) => {
      if (onPreviewGrantedFile) {
        onPreviewGrantedFile(item);
      }
    },
    [onPreviewGrantedFile],
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-[28px] font-bold leading-tight text-[#1A1A1A]">Shared Files</h1>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1D4ED8]"
          onClick={onShareNavigate}
        >
          <Share2 className="size-4" aria-hidden />
          Share a File
        </button>
      </div>

      <SharedFilesTabs activeTab={activeTab} onSelect={setActiveTab} />

      {error ? <p className="text-sm text-[#EF4444]">{error}</p> : null}

      {activeTab === "with-me" ? (
        <SharedWithMeTable
          items={withMeItems}
          loading={loadingWithMe}
          onPreview={handlePreview}
          onRefresh={onRefreshWithMe}
        />
      ) : (
        <SharedByMeSection
          items={byMeItems}
          metrics={byMeMetrics}
          loading={loadingByMe}
          onManage={handleManage}
        />
      )}
    </div>
  );
}
