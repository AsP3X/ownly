// Human: React context for configured instance branding — consumed by useInstanceName and InstanceNameProvider.
// Agent: EXPORTS InstanceNameContext + value type; NO components in this file (fast refresh safe).

import { createContext } from "react";

export type InstanceNameContextValue = {
  instanceName: string;
  setInstanceName: (name: string) => void;
};

export const InstanceNameContext = createContext<InstanceNameContextValue | null>(null);
