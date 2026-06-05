// Human: Read instance branding and shared dashboard stats from InstanceNameProvider.
// Agent: READS InstanceNameContext; THROWS if provider missing; RETURNS instanceName + refreshDashboard.

import { useContext } from "react";
import { InstanceNameContext } from "@/context/instance-name-context";

export function useInstanceName() {
  const context = useContext(InstanceNameContext);
  if (!context) {
    throw new Error("useInstanceName must be used within InstanceNameProvider");
  }
  return context;
}
