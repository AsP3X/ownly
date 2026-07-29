// Human: Full editor settings panel — appearance, indent, display, and behavior toggles.
// Agent: CONTROLLED preferences + theme; EMITS partial preference updates to the dialog.

import { Minus, Plus } from "lucide-react";
import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import type { EditorPreferences, EditorRenderWhitespace } from "@/lib/text-code-editor/preferences";
import { clampFontSize, FONT_SIZE_MAX, FONT_SIZE_MIN } from "@/lib/text-code-editor/preferences";
import type { EditorThemePreference } from "@/lib/text-code-editor/theme";
import { cn } from "@/lib/utils";

export type EditorSettingsPanelProps = {
  open: boolean;
  preferences: EditorPreferences;
  themePreference: EditorThemePreference;
  onPreferencesChange: (next: EditorPreferences) => void;
  onThemePreferenceChange: (preference: EditorThemePreference) => void;
};

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const { theme } = useCodeEditorTheme();
  return (
    <label className={cn("flex items-center justify-between gap-3 text-xs", theme.panelText)}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={cn("size-4 rounded", theme.panelCheckbox)}
      />
    </label>
  );
}

function ChipGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
}) {
  const { theme } = useCodeEditorTheme();
  return (
    <div>
      <p className={cn("mb-1.5 text-xs", theme.panelText)}>{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={String(option.id)}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              value === option.id ? theme.panelChipActive : theme.panelChipInactive,
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorSettingsPanel({
  open,
  preferences,
  themePreference,
  onPreferencesChange,
  onThemePreferenceChange,
}: EditorSettingsPanelProps) {
  const { theme } = useCodeEditorTheme();

  if (!open) return null;

  const patch = (partial: Partial<EditorPreferences>) => {
    onPreferencesChange({ ...preferences, ...partial });
  };

  const whitespaceOptions: Array<{ id: EditorRenderWhitespace; label: string }> = [
    { id: "none", label: "None" },
    { id: "selection", label: "Selection" },
    { id: "boundary", label: "Boundary" },
    { id: "trailing", label: "Trailing" },
    { id: "all", label: "All" },
  ];

  return (
    <div
      className={cn(
        "absolute right-3 top-12 z-40 max-h-[min(28rem,calc(100%-4rem))] w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto p-4",
        theme.panel,
      )}
    >
      <p className={cn("mb-3 text-[11px] font-semibold uppercase tracking-wide", theme.panelTitle)}>
        Editor Settings
      </p>

      <div className="space-y-4">
        <ChipGroup
          label="Appearance"
          value={themePreference}
          options={[
            { id: "auto" as const, label: "Auto" },
            { id: "light" as const, label: "Light" },
            { id: "dark" as const, label: "Dark" },
          ]}
          onChange={onThemePreferenceChange}
        />

        <div>
          <p className={cn("mb-1.5 text-xs", theme.panelText)}>Font size</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease font size"
              onClick={() => patch({ fontSize: clampFontSize(preferences.fontSize - 1) })}
              disabled={preferences.fontSize <= FONT_SIZE_MIN}
              className={cn(
                "flex size-7 items-center justify-center rounded-md disabled:opacity-40",
                theme.panelChipInactive,
              )}
            >
              <Minus className="size-3.5" aria-hidden />
            </button>
            <span className={cn("min-w-[3rem] text-center text-xs font-semibold tabular-nums", theme.panelInputText)}>
              {preferences.fontSize}px
            </span>
            <button
              type="button"
              aria-label="Increase font size"
              onClick={() => patch({ fontSize: clampFontSize(preferences.fontSize + 1) })}
              disabled={preferences.fontSize >= FONT_SIZE_MAX}
              className={cn(
                "flex size-7 items-center justify-center rounded-md disabled:opacity-40",
                theme.panelChipInactive,
              )}
            >
              <Plus className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>

        <ChipGroup
          label="Indentation"
          value={preferences.tabSize}
          options={[
            { id: 2, label: "2 spaces" },
            { id: 4, label: "4 spaces" },
            { id: 8, label: "8 spaces" },
          ]}
          onChange={(tabSize) => patch({ tabSize })}
        />

        <ChipGroup
          label="Whitespace"
          value={preferences.renderWhitespace}
          options={whitespaceOptions}
          onChange={(renderWhitespace) => patch({ renderWhitespace })}
        />

        <div className="space-y-2.5 border-t border-black/5 pt-3 dark:border-white/10">
          <ToggleRow
            label="Insert spaces"
            checked={preferences.insertSpaces}
            onChange={(insertSpaces) => patch({ insertSpaces })}
          />
          <ToggleRow
            label="Word wrap"
            checked={preferences.wordWrap}
            onChange={(wordWrap) => patch({ wordWrap })}
          />
          <ToggleRow
            label="Minimap"
            checked={preferences.minimap}
            onChange={(minimap) => patch({ minimap })}
          />
          <ToggleRow
            label="Line numbers"
            checked={preferences.lineNumbers}
            onChange={(lineNumbers) => patch({ lineNumbers })}
          />
          <ToggleRow
            label="Sticky scroll"
            checked={preferences.stickyScroll}
            onChange={(stickyScroll) => patch({ stickyScroll })}
          />
          <ToggleRow
            label="Bracket pair colors"
            checked={preferences.bracketPairColorization}
            onChange={(bracketPairColorization) => patch({ bracketPairColorization })}
          />
          <ToggleRow
            label="Smooth scrolling"
            checked={preferences.smoothScrolling}
            onChange={(smoothScrolling) => patch({ smoothScrolling })}
          />
          <ToggleRow
            label="Format on paste"
            checked={preferences.formatOnPaste}
            onChange={(formatOnPaste) => patch({ formatOnPaste })}
          />
          <ToggleRow
            label="Format on type"
            checked={preferences.formatOnType}
            onChange={(formatOnType) => patch({ formatOnType })}
          />
        </div>

        <p className={cn("text-[10px] leading-relaxed", theme.panelTitle)}>
          Tip: F1 opens the command palette. ⌘F find · ⌘⌥F replace · ⌘G go to line · ⌘S save ·
          ⌘/ comment · Alt+click multi-cursor · Ctrl+scroll zoom.
        </p>
      </div>
    </div>
  );
}
