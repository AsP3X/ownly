// Human: Light/dark switch pinned to the auth shell corner — the scene and card follow it instantly.
// Agent: READS useTheme().resolved; WRITES an explicit light/dark preference (leaves `system` behind on first use).

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function AuthThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "group relative inline-flex size-10 items-center justify-center overflow-hidden rounded-full touch:size-11",
        "border border-edge/70 bg-panel/70 text-ink-muted backdrop-blur-md",
        "transition-[transform,background-color,color,box-shadow] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:text-brand hover:shadow-lg hover:shadow-black/10 active:translate-y-0 active:scale-95",
        "focus-visible:ring-2 focus-visible:ring-focus/45 focus-visible:outline-none",
        className,
      )}
    >
      {/* Human: Both glyphs stay mounted and cross-rotate so the swap reads as one motion. */}
      <Sun
        className={cn(
          "absolute size-[18px] transition-all duration-300 ease-out",
          isDark ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100",
        )}
        aria-hidden
      />
      <Moon
        className={cn(
          "absolute size-[18px] transition-all duration-300 ease-out",
          isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0",
        )}
        aria-hidden
      />
    </button>
  );
}
