// Human: Loads instance branding + dashboard stats once per session and keeps document.title in sync.
// Agent: READS fetchDashboard on token; WRITES InstanceNameContext; EXPOSES refreshDashboard for drive.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchDashboard, type DashboardResponse } from "@/api/client";
import { InstanceNameContext } from "@/context/instance-name-context";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_INSTANCE_NAME, applyInstanceDocumentTitle } from "@/lib/instance-name";

export function InstanceNameProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [configuredName, setConfiguredName] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const dashboardFetchRef = useRef<Promise<DashboardResponse | null> | null>(null);

  const setInstanceName = useCallback((name: string) => {
    const trimmed = name.trim() || DEFAULT_INSTANCE_NAME;
    setConfiguredName(trimmed);
    applyInstanceDocumentTitle(trimmed);
  }, []);

  // Human: Guests see the product default; signed-in users see the value from app_settings.
  const instanceName = token ? (configuredName ?? DEFAULT_INSTANCE_NAME) : DEFAULT_INSTANCE_NAME;

  // Human: Single deduped GET /dashboard — drive shell and sidebar share one in-flight request.
  // Agent: READS token; CACHES promise in dashboardFetchRef; WRITES dashboard + instanceName.
  const refreshDashboard = useCallback(async (): Promise<DashboardResponse | null> => {
    if (!token) return null;
    if (dashboardFetchRef.current) return dashboardFetchRef.current;

    const promise = fetchDashboard()
      .then((nextDashboard) => {
        setDashboard(nextDashboard);
        setInstanceName(nextDashboard.instance_name);
        return nextDashboard;
      })
      .catch(() => {
        setInstanceName(DEFAULT_INSTANCE_NAME);
        return null;
      })
      .finally(() => {
        dashboardFetchRef.current = null;
      });

    dashboardFetchRef.current = promise;
    return promise;
  }, [token, setInstanceName]);

  // Human: On sign-out, revert the browser tab to the product default and drop cached stats.
  // Agent: READS token; CALLS refreshDashboard when signed in.
  useEffect(() => {
    if (!token) {
      setDashboard(null);
      setConfiguredName(null);
      applyInstanceDocumentTitle(DEFAULT_INSTANCE_NAME);
      dashboardFetchRef.current = null;
      return;
    }

    void refreshDashboard();
  }, [token, refreshDashboard]);

  const value = useMemo(
    () => ({ instanceName, setInstanceName, dashboard, refreshDashboard }),
    [instanceName, setInstanceName, dashboard, refreshDashboard],
  );

  return <InstanceNameContext.Provider value={value}>{children}</InstanceNameContext.Provider>;
}
