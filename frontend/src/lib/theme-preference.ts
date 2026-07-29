// Human: Drive theme preference — persistence and resolution of light/dark/system.
// Agent: READS/WRITES localStorage `ownly_theme`; APPLIES the `dark` class to <html>.

const THEME_KEY = "ownly_theme";

/** Human: What the user picked. `system` follows the OS setting live. */
export type ThemePreference = "light" | "dark" | "system";

/** Human: What is actually painted after resolving `system`. */
export type ResolvedTheme = "light" | "dark";

const THEME_PREFERENCES = new Set<ThemePreference>(["light", "dark", "system"]);

export const THEME_PREFERENCE_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

// Human: Restore the saved theme choice; unknown or unreadable values fall back to `system`.
// Agent: READS ownly_theme; TOLERATES private-mode localStorage failures.
export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw !== null && THEME_PREFERENCES.has(raw as ThemePreference)) {
      return raw as ThemePreference;
    }
  } catch {
    // Agent: Ignore private-mode or quota failures; fall back to the system default.
  }
  return "system";
}

// Human: Persist the theme choice so it survives reloads.
// Agent: WRITES ownly_theme; SWALLOWS quota/private-mode errors so the toggle never throws.
export function writeThemePreference(theme: ThemePreference) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Agent: Preference is best-effort; the in-memory theme still applies for this session.
  }
}

// Human: Current OS-level colour scheme, used to resolve the `system` preference.
// Agent: READS matchMedia(prefers-color-scheme: dark); RETURNS light when unsupported/SSR.
export function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Human: Collapse a preference plus the OS setting into the theme that should paint.
// Agent: RETURNS preference verbatim unless it is `system`, which defers to readSystemTheme().
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? readSystemTheme() : preference;
}

// Human: Single place that touches the DOM for theming — toggles `dark` on <html>.
// Agent: WRITES documentElement.classList; matches the @custom-variant dark selector in index.css.
export function applyResolvedTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}
