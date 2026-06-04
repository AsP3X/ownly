// Human: Keep drive navigation (view, folder path, search, filters) in the URL for reload/back support.
// Agent: READS useSearchParams on mount; WRITES search via replaceState; RESOLVES folder ids with listFolders.

import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { listFolders } from "@/api/client";
import type { DriveNavId } from "@/components/drive/DriveSidebar";
import {
  buildDriveSearchParams,
  DRIVE_FOLDER_PARAM,
  DRIVE_QUERY_PARAM,
  DRIVE_TYPE_PARAM,
  DRIVE_VIEW_PARAM,
  parseDriveFolderParam,
  parseDriveTypeParam,
  parseDriveViewParam,
} from "@/lib/app-location-state";
import type { FileTypeFilter } from "@/lib/utils-app";

type FolderCrumb = { id: string; name: string };

type DriveUrlSyncInput = {
  activeNav: DriveNavId;
  folderStack: FolderCrumb[];
  query: string;
  typeFilter: FileTypeFilter;
  setActiveNav: (nav: DriveNavId) => void;
  setFolderStack: (stack: FolderCrumb[] | ((prev: FolderCrumb[]) => FolderCrumb[])) => void;
  setQuery: (query: string) => void;
  setTypeFilter: (filter: FileTypeFilter) => void;
};

/** Human: Hydrate drive state from the URL once, then mirror state changes back into search params. */
export function useDriveUrlState({
  activeNav,
  folderStack,
  query,
  typeFilter,
  setActiveNav,
  setFolderStack,
  setQuery,
  setTypeFilter,
}: DriveUrlSyncInput) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hydratedRef = useRef(false);
  const resolvingFoldersRef = useRef(false);

  // Human: On first mount, apply view/search/filter/folder ids from the current URL.
  // Agent: RUNS once; SKIPS folder resolution when my-files has no folder param.
  useEffect(() => {
    if (hydratedRef.current) return;

    const view = parseDriveViewParam(searchParams.get(DRIVE_VIEW_PARAM));
    if (view) setActiveNav(view);

    const type = parseDriveTypeParam(searchParams.get(DRIVE_TYPE_PARAM));
    if (type) setTypeFilter(type);

    const q = searchParams.get(DRIVE_QUERY_PARAM);
    if (q) setQuery(q);

    const folderIds = parseDriveFolderParam(searchParams.get(DRIVE_FOLDER_PARAM));
    const effectiveView = view ?? "home";
    const needsFolderResolve =
      folderIds.length > 0 && effectiveView === "my-files";

    if (!needsFolderResolve) {
      hydratedRef.current = true;
      return;
    }

    let cancelled = false;
    resolvingFoldersRef.current = true;

    void (async () => {
      const crumbs: FolderCrumb[] = [];
      let parentId: string | null = null;
      for (const folderId of folderIds) {
        try {
          const res = await listFolders(
            parentId ? { parent_id: parentId } : undefined,
          );
          const match = res.folders.find((folder) => folder.id === folderId);
          if (!match) break;
          crumbs.push({ id: match.id, name: match.name });
          parentId = match.id;
        } catch {
          break;
        }
      }
      if (cancelled) return;
      if (crumbs.length > 0) {
        setActiveNav("my-files");
        setFolderStack(crumbs);
      }
      resolvingFoldersRef.current = false;
      hydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
      resolvingFoldersRef.current = false;
    };
    // Human: Intentionally mount-only — subsequent URL edits come from the mirror effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from initial searchParams
  }, []);

  const syncUrlFromState = useCallback(() => {
    if (!hydratedRef.current || resolvingFoldersRef.current) return;

    const next = buildDriveSearchParams({
      view: activeNav,
      folderIds:
        activeNav === "my-files" ? folderStack.map((crumb) => crumb.id) : [],
      query,
      typeFilter,
    });

    const current = new URLSearchParams(searchParams);
    if (next.toString() === current.toString()) return;

    setSearchParams(next, { replace: true });
  }, [activeNav, folderStack, query, typeFilter, searchParams, setSearchParams]);

  useEffect(() => {
    syncUrlFromState();
  }, [syncUrlFromState]);
}
