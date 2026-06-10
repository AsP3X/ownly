// Human: Polls GET /dashboard for the signed-in user's upload rate-limit headroom.
// Agent: READS upload_rate_limit; DEDUPES in-flight fetches; NEVER hooks upload progress events.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboard, type UploadRateLimitStatus } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeUploadFileComplete } from "@/lib/upload-manager";

const POLL_INTERVAL_MS = 15_000;
/** Human: Minimum spacing between dashboard polls so bursts cannot stampede the API. */
const MIN_REFRESH_GAP_MS = 5_000;

// Human: Live upload throttle snapshot for sidebar widgets — null while loading or signed out.
// Agent: CALLS fetchDashboard on interval + after each completed upload (throttled); DEDUPES concurrent requests.
export function useUploadRateLimit() {
  const { token } = useAuth();
  const [status, setStatus] = useState<UploadRateLimitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastRefreshAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) return;

    const now = Date.now();
    if (now - lastRefreshAtRef.current < MIN_REFRESH_GAP_MS) {
      return inFlightRef.current ?? undefined;
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    setLoading(true);
    const promise = fetchDashboard()
      .then((dashboard) => {
        setStatus(dashboard.upload_rate_limit ?? null);
        lastRefreshAtRef.current = Date.now();
      })
      .catch(() => {
        // Human: Keep the last known snapshot when a background poll fails.
        // Agent: SWALLOWS transient errors so the sidebar does not flicker empty.
      })
      .finally(() => {
        inFlightRef.current = null;
        setLoading(false);
      });

    inFlightRef.current = promise;
    return promise;
  }, [token]);

  useEffect(() => {
    if (!token) return;

    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    // Human: Refresh after a file finishes uploading — not on every progress tick.
    // Agent: SUBSCRIBES subscribeUploadFileComplete only; THROTTLED by MIN_REFRESH_GAP_MS + inFlightRef.
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
