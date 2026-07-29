// Human: Read and change the drive light/dark theme from any component under ThemeProvider.
// Agent: READS ThemeContext; THROWS if provider missing; RETURNS preference + resolved + setPreference.

import { useContext } from "react";
import { ThemeContext } from "@/context/theme-context";

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
