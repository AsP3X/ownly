// Human: Polls GET /dashboard for the signed-in user's upload rate-limit headroom.
// Agent: READS upload_rate_limit from dashboard; REFRESHES on interval and after upload batch changes.

import { useCallback, useEffect, useState } from "react";
import { fetchDashboard, type UploadRateLimitStatus } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeUploadBatch } from "@/lib/upload-manager";

const POLL_INTERVAL_MS = 8_000;

// Human: Live upload throttle snapshot for sidebar widgets — null while loading or signed out.
// Agent: CALLS fetchDashboard; SUBSCRIBES subscribeUploadBatch for faster refresh during uploads.
export function useUploadRateLimit() {
  const { token } = useAuth();
  const [status, setStatus] = useState<UploadRateLimitStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const dashboard = await fetchDashboard();
      setStatus(dashboard.upload_rate_limit ?? null);
    } catch {
      // Human: Keep the last known snapshot when a background poll fails.
      // Agent: SWALLOWS transient errors so the sidebar does not flicker empty.
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial poll on mount and token change
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    const unsubscribe = subscribeUploadBatch(() => {
      void refresh();
    });

    return () => {
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [token, refresh]);

  return {
    status: token ? status : null,
    loading: Boolean(token && loading),
    refresh,
  };
}
