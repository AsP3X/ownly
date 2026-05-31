// Human: Read the configured instance name from InstanceNameProvider anywhere in the React tree.
// Agent: READS InstanceNameContext; THROWS if provider missing; RETURNS instanceName + setInstanceName.

import { useContext } from "react";
import { InstanceNameContext } from "@/context/instance-name-context";

export function useInstanceName() {
  const context = useContext(InstanceNameContext);
  if (!context) {
    throw new Error("useInstanceName must be used within InstanceNameProvider");
  }
  return context;
}
