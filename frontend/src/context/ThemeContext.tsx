// Human: Owns the drive light/dark theme — restores the saved choice and keeps <html> in sync.
// Agent: READS localStorage via theme-preference; SUBSCRIBES to prefers-color-scheme; WRITES ThemeContext.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeContext } from "@/context/theme-context";
import {
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme-preference";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Human: Lazy initialisers read localStorage/matchMedia once, before the first paint.
  // Agent: index.html already applied the same class, so this matches what is on screen.
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(),
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(readThemePreference()),
  );

  // Human: Persist the user's choice and repaint immediately.
  // Agent: WRITES ownly_theme; RECOMPUTES resolved theme; DOM update happens in the effect below.
  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemePreference(next);
    setResolved(resolveTheme(next));
  }, []);

  // Human: Apply the resolved theme to <html> whenever it changes.
  // Agent: WRITES documentElement class via applyResolvedTheme.
  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  // Human: While on `system`, follow the OS switching between light and dark at runtime.
  // Agent: SUBSCRIBES to prefers-color-scheme; NO-OP for explicit light/dark preferences.
  useEffect(() => {
    if (preference !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange(event: MediaQueryListEvent) {
      setResolved(event.matches ? "dark" : "light");
    }

    mediaQuery.addEventListener("change", handleChange);
    // Human: Re-sync on subscribe in case the OS changed while an explicit theme was active.
    setResolved(mediaQuery.matches ? "dark" : "light");
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
