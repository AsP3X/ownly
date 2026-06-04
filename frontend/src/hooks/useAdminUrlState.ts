// Human: Mirror the active admin sidebar section into `?section=` so reload keeps the same panel.
// Agent: READS useSearchParams on mount; WRITES section param with replace when state changes.

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminNavId } from "@/components/admin/AdminSidebar";
import {
  ADMIN_SECTION_PARAM,
  buildAdminSearchParams,
  parseAdminSectionParam,
} from "@/lib/app-location-state";

/** Human: Hydrate admin nav from URL once, then keep the query string aligned with activeNav. */
export function useAdminUrlState(
  activeNav: AdminNavId,
  setActiveNav: (nav: AdminNavId) => void,
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const section = parseAdminSectionParam(searchParams.get(ADMIN_SECTION_PARAM));
    if (section) setActiveNav(section);
    // Human: Mount-only hydration from the URL the user reloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial searchParams only
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const next = buildAdminSearchParams(activeNav);
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [activeNav, searchParams, setSearchParams]);
}
