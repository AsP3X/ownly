// Human: ⌘K finder — type-ahead over folders and files with their location, plus quick commands.
// Agent: DEBOUNCES listFiles/listFolders; RESOLVES trails via fetchFolderPaths behind a per-session cache.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CornerDownLeft,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  batchFiles,
  fetchFolderPaths,
  getErrorMessage,
  listFiles,
  listFolders,
  type FileItem,
  type FolderItem,
  type FolderPathSegment,
} from "@/api/client";
import { ExplorerFileGlyph } from "@/components/drive/ExplorerFileGlyph";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  filterCommandActions,
  rankByNameMatch,
  type DriveCommandAction,
  type DriveCommandActionId,
} from "@/lib/drive-command-palette";
import { getRecentFileIds, sortFilesByRecentAccess } from "@/lib/drive-preferences";
import { formatFolderPathLabel, ROOT_FOLDER_LABEL } from "@/lib/folder-path";
import { cn } from "@/lib/utils";

/** Human: Idle time after the last keystroke before the palette queries the API. */
const SEARCH_DEBOUNCE_MS = 180;
/** Human: How many hits of each kind one page of palette results shows. */
const FILE_RESULT_LIMIT = 8;
const FOLDER_RESULT_LIMIT = 6;
/** Human: Recently opened files offered before anything is typed. */
const RECENT_RESULT_LIMIT = 6;
/** Human: Placeholder while a folder trail is still being resolved. */
const PENDING_LOCATION_LABEL = "…";

type DriveCommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human: Open a file the way activating its explorer row would. */
  onOpenFile: (file: FileItem) => void;
  /** Human: Point the explorer at a folder trail — opens folders and reveals a file's location. */
  onOpenFolderPath: (path: FolderPathSegment[]) => void;
  /** Human: Run the typed query as a full search in the My Cloud explorer. */
  onSearchInDrive: (query: string) => void;
  onRunAction: (action: DriveCommandActionId) => void;
};

/** Human: One selectable line; every kind shares the same keyboard lane. */
type PaletteRow =
  | { kind: "folder"; key: string; folder: FolderItem }
  | { kind: "file"; key: string; file: FileItem }
  | { kind: "action"; key: string; action: DriveCommandAction }
  | { kind: "search-all"; key: string };

const ACTION_ICONS: Record<DriveCommandActionId, typeof Upload> = {
  upload: Upload,
  "new-folder": FolderPlus,
  "go-my-files": Folder,
  "go-home": Home,
  "go-shared-files": Users,
  "go-recycle-bin": Trash2,
};

// Human: Search across the whole library and jump straight to what you find.
// Agent: OWNS query/result state; PARENT owns what open, reveal, and each command actually do.
export function DriveCommandPalette({
  open,
  onOpenChange,
  onOpenFile,
  onOpenFolderPath,
  onSearchInDrive,
  onRunAction,
}: DriveCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [folderPaths, setFolderPaths] = useState<Record<string, FolderPathSegment[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const trimmedQuery = query.trim();
  const isBrowsingRecents = debouncedQuery.length === 0;

  // Human: Start each session clean so a stale query never flashes before new results land.
  // Agent: DROPS the path cache too, so a folder renamed elsewhere cannot linger in a label.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setDebouncedQuery("");
    setFiles([]);
    setFolders([]);
    setFolderPaths({});
    setError("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(trimmedQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmedQuery]);

  // Human: Fetch hits for the settled query, or recently opened files when nothing is typed.
  // Agent: GUARDS with a cancelled flag so a slow response cannot overwrite a newer one.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        if (debouncedQuery.length === 0) {
          const recentIds = getRecentFileIds().slice(0, RECENT_RESULT_LIMIT);
          const recent =
            recentIds.length > 0 ? (await batchFiles(recentIds, "minimal")).files : [];
          if (cancelled) return;
          setFolders([]);
          setFiles(sortFilesByRecentAccess(recent, RECENT_RESULT_LIMIT));
        } else {
          const [fileListing, folderListing] = await Promise.all([
            listFiles({
              q: debouncedQuery,
              limit: FILE_RESULT_LIMIT,
              offset: 0,
              fields: "minimal",
            }),
            listFolders({ q: debouncedQuery, limit: FOLDER_RESULT_LIMIT, offset: 0 }),
          ]);
          if (cancelled) return;
          setFiles(rankByNameMatch(fileListing.files, debouncedQuery));
          setFolders(rankByNameMatch(folderListing.folders, debouncedQuery));
        }
        setError("");
      } catch (e) {
        if (cancelled) return;
        setFiles([]);
        setFolders([]);
        setError(getErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  // Human: Resolve where each hit lives, so every row can show a location and jump to it.
  // Agent: ONE batched POST per result page; cached ids are never requested again.
  useEffect(() => {
    const wanted = new Set<string>();
    for (const file of files) {
      if (file.folder_id) wanted.add(file.folder_id);
    }
    for (const folder of folders) {
      wanted.add(folder.id);
    }
    const missing = [...wanted].filter((id) => folderPaths[id] === undefined);
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const { paths } = await fetchFolderPaths(missing);
        if (cancelled) return;
        // Human: Record misses as empty trails too, or unknown ids re-request on every render.
        const resolved: Record<string, FolderPathSegment[]> = {};
        for (const id of missing) {
          resolved[id] = paths[id] ?? [];
        }
        setFolderPaths((current) => ({ ...current, ...resolved }));
      } catch {
        // Human: Location labels are decoration — a failed lookup must not break the results list.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, folders, folderPaths]);

  const actions = useMemo(() => filterCommandActions(trimmedQuery), [trimmedQuery]);

  const rows = useMemo<PaletteRow[]>(() => {
    const next: PaletteRow[] = [
      ...folders.map((folder) => ({ kind: "folder" as const, key: `folder-${folder.id}`, folder })),
      ...files.map((file) => ({ kind: "file" as const, key: `file-${file.id}`, file })),
      ...actions.map((action) => ({ kind: "action" as const, key: `action-${action.id}`, action })),
    ];
    if (trimmedQuery.length > 0) {
      next.push({ kind: "search-all", key: "search-all" });
    }
    return next;
  }, [actions, files, folders, trimmedQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [rows.length]);

  // Human: Keep the highlighted row visible while arrowing through a long result list.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-palette-active='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Human: Where a file sits — its folder trail, or the drive root when it has no folder.
  const fileLocationLabel = useCallback(
    (file: FileItem) => {
      if (!file.folder_id) return ROOT_FOLDER_LABEL;
      const path = folderPaths[file.folder_id];
      return path === undefined ? PENDING_LOCATION_LABEL : formatFolderPathLabel(path);
    },
    [folderPaths],
  );

  // Human: Where a folder sits — its own trail minus itself, since the row already names it.
  const folderLocationLabel = useCallback(
    (folder: FolderItem) => {
      const path = folderPaths[folder.id];
      return path === undefined
        ? PENDING_LOCATION_LABEL
        : formatFolderPathLabel(path.slice(0, -1));
    },
    [folderPaths],
  );

  // Human: Activate a row — open it, or reveal where it lives when a modifier is held.
  // Agent: CLOSES the palette first so the explorer is not left behind an overlay.
  const runRow = useCallback(
    (row: PaletteRow, reveal: boolean) => {
      onOpenChange(false);
      switch (row.kind) {
        case "folder":
          onOpenFolderPath(
            folderPaths[row.folder.id] ?? [{ id: row.folder.id, name: row.folder.name }],
          );
          break;
        case "file":
          if (reveal) {
            onOpenFolderPath(
              row.file.folder_id ? (folderPaths[row.file.folder_id] ?? []) : [],
            );
          } else {
            onOpenFile(row.file);
          }
          break;
        case "action":
          onRunAction(row.action.id);
          break;
        case "search-all":
          onSearchInDrive(trimmedQuery);
          break;
      }
    },
    [
      folderPaths,
      onOpenChange,
      onOpenFile,
      onOpenFolderPath,
      onRunAction,
      onSearchInDrive,
      trimmedQuery,
    ],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % rows.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + rows.length) % rows.length);
      return;
    }
    if (event.key === "Enter") {
      const row = rows[activeIndex];
      if (!row) return;
      event.preventDefault();
      runRow(row, event.altKey || event.metaKey || event.ctrlKey);
    }
  }

  // Human: Heading shown above the first row of each kind.
  function groupLabelFor(row: PaletteRow): string {
    switch (row.kind) {
      case "folder":
        return "Folders";
      case "file":
        return isBrowsingRecents ? "Recent" : "Files";
      case "action":
        return "Commands";
      case "search-all":
        return "Search";
    }
  }

  // Human: Icon, name, and location line for one row, whatever kind it is.
  function rowContent(row: PaletteRow): { icon: ReactNode; title: string; subtitle: string } {
    switch (row.kind) {
      case "folder":
        return {
          icon: <Folder className="size-4" aria-hidden />,
          title: row.folder.name,
          subtitle: folderLocationLabel(row.folder),
        };
      case "file":
        return {
          icon: <ExplorerFileGlyph mimeType={row.file.mime_type} className="size-4" />,
          title: row.file.name,
          subtitle: fileLocationLabel(row.file),
        };
      case "action": {
        const ActionIcon = ACTION_ICONS[row.action.id];
        return {
          icon: <ActionIcon className="size-4" aria-hidden />,
          title: row.action.label,
          subtitle: "Command",
        };
      }
      case "search-all":
        return {
          icon: <Search className="size-4" aria-hidden />,
          title: `See all results for “${trimmedQuery}”`,
          subtitle: `Search ${ROOT_FOLDER_LABEL}`,
        };
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[10vh] w-full max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden rounded-xl border border-edge bg-panel p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search your drive and run commands</DialogTitle>

        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-ink-faint" aria-hidden />
          ) : (
            <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
          )}
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files and folders, or type a command…"
            aria-label="Search files and folders, or type a command"
            role="combobox"
            aria-expanded
            aria-controls="drive-command-palette-results"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>

        <ul
          ref={listRef}
          id="drive-command-palette-results"
          role="listbox"
          aria-label="Search results and commands"
          className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5"
        >
          {error ? (
            <li className="px-3 py-6 text-center text-[13px] text-danger">{error}</li>
          ) : null}

          {rows.map((row, index) => {
            const { icon, title, subtitle } = rowContent(row);
            const startsGroup = rows[index - 1]?.kind !== row.kind;
            const active = index === activeIndex;
            return (
              <Fragment key={row.key}>
                {startsGroup ? (
                  <li
                    aria-hidden
                    className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
                  >
                    {groupLabelFor(row)}
                  </li>
                ) : null}
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-palette-active={active}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={(event) =>
                      runRow(row, event.altKey || event.metaKey || event.ctrlKey)
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      active ? "bg-surface" : "hover:bg-surface/60",
                    )}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-ink-muted">
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {title}
                      </span>
                      <span className="block truncate text-[11px] text-ink-faint">{subtitle}</span>
                    </span>
                    {/* Human: Only the highlighted file advertises reveal — on every row it is noise. */}
                    {row.kind === "file" && active ? (
                      <span className="shrink-0 text-[11px] text-ink-faint max-sm:hidden">
                        ⌥↵ reveal
                      </span>
                    ) : null}
                  </button>
                </li>
              </Fragment>
            );
          })}

          {!loading && !error && rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-ink-muted">
              Nothing matches “{trimmedQuery}”
            </li>
          ) : null}
        </ul>

        <div className="flex items-center gap-4 border-t border-hairline bg-surface/60 px-4 py-2 text-[11px] text-ink-faint max-sm:hidden">
          <span className="flex items-center gap-1.5">
            <CornerDownLeft className="size-3" aria-hidden /> open
          </span>
          <span>↑↓ navigate</span>
          <span>⌥↵ reveal in folder</span>
          <span className="ml-auto">esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
