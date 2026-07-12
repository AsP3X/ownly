// Human: Mobile reading settings bottom sheet — font, theme, spacing from pen design.
// Agent: READ/WRITE EpubReaderPreferences via controller setPreferences.

import { ChevronRight, X } from "lucide-react";
import type { EpubReaderLineSpacing, EpubReaderPreferences } from "@/lib/epub-reader-preference";
import { cn } from "@/lib/utils";

type EpubReaderSettingsSheetProps = {
  open: boolean;
  preferences: EpubReaderPreferences;
  onClose: () => void;
  onChange: (next: EpubReaderPreferences) => void;
};

const FONT_LABELS = { small: "Small", medium: "Medium", large: "Large" } as const;
const THEME_LABELS = { light: "Light", dark: "Dark", sepia: "Sepia" } as const;
const SPACING_LABELS = { compact: "Compact", comfortable: "Comfortable", relaxed: "Relaxed" } as const;

const SPACING_ORDER: EpubReaderLineSpacing[] = ["compact", "comfortable", "relaxed"];

function cycleSpacing(current: EpubReaderLineSpacing): EpubReaderLineSpacing {
  const index = SPACING_ORDER.indexOf(current);
  return SPACING_ORDER[(index + 1) % SPACING_ORDER.length] ?? current;
}

export function EpubReaderSettingsSheet({
  open,
  preferences,
  onClose,
  onChange,
}: EpubReaderSettingsSheetProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="rounded-t-2xl border-t border-border bg-background px-5 pb-8 pt-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Reading Settings</h2>
          <button type="button" aria-label="Close settings" onClick={onClose} className="text-muted-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-1">
          {[
            {
              label: "Font size",
              value: FONT_LABELS[preferences.fontSize],
              onClick: () => {
                const order = ["small", "medium", "large"] as const;
                const index = order.indexOf(preferences.fontSize);
                onChange({ ...preferences, fontSize: order[(index + 1) % order.length] ?? "medium" });
              },
            },
            {
              label: "Theme",
              value: THEME_LABELS[preferences.theme],
              onClick: () => {
                const order = ["light", "sepia", "dark"] as const;
                const index = order.indexOf(preferences.theme);
                onChange({ ...preferences, theme: order[(index + 1) % order.length] ?? "light" });
              },
            },
            {
              label: "Line spacing",
              value: SPACING_LABELS[preferences.lineSpacing],
              onClick: () => onChange({ ...preferences, lineSpacing: cycleSpacing(preferences.lineSpacing) }),
            },
            {
              label: "Margins",
              value: "Default",
              onClick: () => undefined,
            },
          ].map((row) => (
            <button
              key={row.label}
              type="button"
              className="flex w-full items-center justify-between rounded-lg px-1 py-3 text-left"
              onClick={row.onClick}
            >
              <span className="text-sm font-medium text-foreground">{row.label}</span>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {row.value}
                <ChevronRight className={cn("size-4", row.label === "Margins" && "opacity-40")} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
