// Human: React context for the drive light/dark theme — consumed by useTheme.
// Agent: EXPORTS ThemeContext + value type; NO components in this file (fast refresh safe).

import { createContext } from "react";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme-preference";

export type ThemeContextValue = {
  /** Human: What the user picked — `system` tracks the OS setting live. */
  preference: ThemePreference;
  /** Human: What is actually painted right now, after resolving `system`. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);
