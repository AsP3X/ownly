// Human: Light/dark switch for the setup header bar — plain control, no glass or hover lift.
// Agent: READS useTheme().resolved; WRITES an explicit light/dark preference (leaves `system` behind on first use).
// Separate from AuthThemeToggle, which is styled to float over the auth scene.

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export function SetupThemeToggle() {
  const { resolved, setPreference } = useTheme();
  const isDark = resolved === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className="flex size-10 items-center justify-center rounded-md border border-edge bg-panel text-ink-muted transition-colors duration-150 hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/30 focus-visible:outline-none sm:size-8"
    >
      {isDark ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
    </button>
  );
}
