// Human: Loads instance branding after login and keeps document.title in sync with admin changes.
// Agent: READS fetchDashboard on token; WRITES InstanceNameContext; EXPOSES setInstanceName for admin saves.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchDashboard } from "@/api/client";
import { InstanceNameContext } from "@/context/instance-name-context";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_INSTANCE_NAME, applyInstanceDocumentTitle } from "@/lib/instance-name";

export function InstanceNameProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [configuredName, setConfiguredName] = useState<string | null>(null);

  const setInstanceName = useCallback((name: string) => {
    const trimmed = name.trim() || DEFAULT_INSTANCE_NAME;
    setConfiguredName(trimmed);
    applyInstanceDocumentTitle(trimmed);
  }, []);

  // Human: Guests see the product default; signed-in users see the value from app_settings.
  const instanceName = token ? (configuredName ?? DEFAULT_INSTANCE_NAME) : DEFAULT_INSTANCE_NAME;

  // Human: On sign-out, revert the browser tab to the product default.
  // Agent: READS token; CALLS fetchDashboard in async callback when signed in.
  useEffect(() => {
    if (!token) {
      applyInstanceDocumentTitle(DEFAULT_INSTANCE_NAME);
      return;
    }

    let cancelled = false;
    fetchDashboard()
      .then((dashboard) => {
        if (!cancelled) setInstanceName(dashboard.instance_name);
      })
      .catch(() => {
        if (!cancelled) setInstanceName(DEFAULT_INSTANCE_NAME);
      });

    return () => {
      cancelled = true;
    };
  }, [token, setInstanceName]);

  const value = useMemo(
    () => ({ instanceName, setInstanceName }),
    [instanceName, setInstanceName],
  );

  return <InstanceNameContext.Provider value={value}>{children}</InstanceNameContext.Provider>;
}
