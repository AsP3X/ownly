// Human: Live network storage used/capacity for admin chrome (sidebar global capacity widget).
// Agent: CALLS GET /admin/storage on mount; RETURNS used_bytes and capacity_bytes from metrics.

import { useCallback, useEffect, useState } from "react";
import { fetchAdminStorage, getErrorMessage } from "@/api/client";

export type AdminStorageMetricsSnapshot = {
  usedBytes: number;
  capacityBytes: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/** Human: Fetch aggregated storage metrics for admin sidebar capacity footer. */
export function useAdminStorageMetrics(): AdminStorageMetricsSnapshot {
  const [usedBytes, setUsedBytes] = useState(0);
  const [capacityBytes, setCapacityBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminStorage();
      setUsedBytes(data.metrics.used_bytes);
      setCapacityBytes(data.metrics.capacity_bytes);
    } catch (err) {
      setError(getErrorMessage(err));
      setUsedBytes(0);
      setCapacityBytes(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial metrics fetch on mount
    void refresh();
  }, [refresh]);

  return { usedBytes, capacityBytes, loading, error, refresh };
}
