// Human: Compact settings popover toggled from the editor header gear icon.
// Agent: CONTROLLED tab size + word wrap + theme; EMITS changes to parent editor state.

import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import type { EditorThemePreference } from "@/lib/text-code-editor/theme";
import { cn } from "@/lib/utils";

export type EditorSettingsPanelProps = {
  open: boolean;
  tabSize: number;
  wordWrap: boolean;
  themePreference: EditorThemePreference;
  onTabSizeChange: (tabSize: number) => void;
  onWordWrapChange: (enabled: boolean) => void;
  onThemePreferenceChange: (preference: EditorThemePreference) => void;
};

export function EditorSettingsPanel({
  open,
  tabSize,
  wordWrap,
  themePreference,
  onTabSizeChange,
  onWordWrapChange,
  onThemePreferenceChange,
}: EditorSettingsPanelProps) {
  const { theme } = useCodeEditorTheme();

  if (!open) return null;

  const themeOptions: Array<{ id: EditorThemePreference; label: string }> = [
    { id: "auto", label: "Auto" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];

  return (
    <div className={cn("absolute right-4 top-11 z-30 w-52 p-3", theme.panel)}>
      <p className={cn("mb-2 text-[11px] font-semibold uppercase tracking-wide", theme.panelTitle)}>
        Editor Settings
      </p>

      <div className="space-y-3">
        <div>
          <p className={cn("mb-1 text-xs", theme.panelText)}>Appearance</p>
          <div className="flex gap-1">
            {themeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onThemePreferenceChange(option.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs",
                  themePreference === option.id
                    ? theme.panelChipActive
                    : theme.panelChipInactive,
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={cn("mb-1 text-xs", theme.panelText)}>Indentation</p>
          <div className="flex gap-1">
            {[2, 4].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onTabSizeChange(size)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs",
                  tabSize === size ? theme.panelChipActive : theme.panelChipInactive,
                )}
              >
                {size} spaces
              </button>
            ))}
          </div>
        </div>

        <label className={cn("flex items-center justify-between gap-3 text-xs", theme.panelText)}>
          Word wrap
          <input
            type="checkbox"
            checked={wordWrap}
            onChange={(event) => onWordWrapChange(event.target.checked)}
            className={cn("size-4 rounded", theme.panelCheckbox)}
          />
        </label>
      </div>
    </div>
  );
}
