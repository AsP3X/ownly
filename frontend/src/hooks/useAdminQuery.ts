// Human: Shared admin-console data fetch hook — loading, error, refresh, and manual reload.
// Agent: CALLS async loader; SETS loading/error/data state; USED by Admin*Panel components.

import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "@/api/client";

type UseAdminQueryOptions = {
  /** Human: When false, skip the initial fetch (e.g. panel not visible). */
  enabled?: boolean;
};

type UseAdminQueryResult<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Human: Timestamp of the last successful fetch — drives "Updated … ago" copy in admin panels. */
  lastUpdatedAt: Date | null;
  reload: (showRefresh?: boolean) => Promise<void>;
};

// Human: Standard admin panel fetch lifecycle without per-panel useEffect boilerplate.
// Agent: READS loader(); WRITES data/loading/error; CALLS loader on mount and reload().
export function useAdminQuery<T>(
  loader: () => Promise<T>,
  options?: UseAdminQueryOptions,
): UseAdminQueryResult<T> {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const reload = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setData(await loader());
        setLastUpdatedAt(new Date());
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loader],
  );

  useEffect(() => {
    if (!enabled) return;
    void reload(false);
  }, [enabled, reload]);

  return { data, loading, refreshing, error, lastUpdatedAt, reload };
}
