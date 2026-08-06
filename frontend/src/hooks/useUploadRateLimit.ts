// Human: Reads upload rate-limit headroom from the shared dashboard context (no separate fetch).
// Agent: READS InstanceNameContext.dashboard; SUBSCRIBES upload-complete events to trigger refreshDashboard.
//        Previously fetched /dashboard independently — now shares the single InstanceNameProvider fetch.

import { useCallback, useEffect, useState } from "react";
import { type UploadRateLimitStatus } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useInstanceName } from "@/hooks/useInstanceName";
import { subscribeUploadFileComplete } from "@/lib/upload-manager";

const POLL_INTERVAL_MS = 15_000;

// Human: Live upload throttle snapshot for sidebar widgets — null while loading or signed out.
// Agent: READS dashboard from InstanceNameContext; POLLS refreshDashboard on interval + after uploads.
export function useUploadRateLimit() {
  const { token } = useAuth();
  const { dashboard, refreshDashboard } = useInstanceName();
  const [status, setStatus] = useState<UploadRateLimitStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // Human: Derive rate-limit status from the shared dashboard whenever it updates.
  // Agent: READS dashboard.upload_rate_limit; WRITES local status state.
  useEffect(() => {
    if (!token || !dashboard) return;
    setStatus(dashboard.upload_rate_limit ?? null);
    setLoading(false);
  }, [token, dashboard]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      await refreshDashboard();
    } catch {
      // Human: Keep the last known snapshot when a background poll fails.
    } finally {
      setLoading(false);
    }
  }, [token, refreshDashboard]);

  useEffect(() => {
    if (!token) return;

    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    // Human: Refresh after a file finishes uploading — not on every progress tick.
    const unsubscribe = subscribeUploadFileComplete(() => {
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
