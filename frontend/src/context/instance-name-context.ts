// Human: React context for instance branding and shared dashboard stats — consumed by useInstanceName.
// Agent: EXPORTS InstanceNameContext + value type; NO components in this file (fast refresh safe).

import { createContext } from "react";
import type { DashboardResponse } from "@/api/client";

export type InstanceNameContextValue = {
  instanceName: string;
  setInstanceName: (name: string) => void;
  /** Human: Latest GET /dashboard payload — null for guests or before first fetch. */
  dashboard: DashboardResponse | null;
  /** Human: Deduped dashboard fetch shared by drive shell and admin branding updates. */
  refreshDashboard: () => Promise<DashboardResponse | null>;
};

export const InstanceNameContext = createContext<InstanceNameContextValue | null>(null);
