// Human: Compact settings popover toggled from the editor header gear icon.
// Agent: CONTROLLED tab size + word wrap; EMITS changes to parent editor state.

import { cn } from "@/lib/utils";

export type EditorSettingsPanelProps = {
  open: boolean;
  tabSize: number;
  wordWrap: boolean;
  onTabSizeChange: (tabSize: number) => void;
  onWordWrapChange: (enabled: boolean) => void;
};

export function EditorSettingsPanel({
  open,
  tabSize,
  wordWrap,
  onTabSizeChange,
  onWordWrapChange,
}: EditorSettingsPanelProps) {
  if (!open) return null;

  return (
    <div className="absolute right-4 top-11 z-30 w-52 rounded-lg border border-[#313244] bg-[#151521] p-3 shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#565F89]">
        Editor Settings
      </p>

      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs text-[#A6ADC8]">Indentation</p>
          <div className="flex gap-1">
            {[2, 4].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onTabSizeChange(size)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs",
                  tabSize === size
                    ? "bg-[#2563EB] font-semibold text-white"
                    : "bg-[#11111B] text-[#A6ADC8] hover:bg-[#1E1E2E]",
                )}
              >
                {size} spaces
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 text-xs text-[#A6ADC8]">
          Word wrap
          <input
            type="checkbox"
            checked={wordWrap}
            onChange={(event) => onWordWrapChange(event.target.checked)}
            className="size-4 rounded border-[#313244] bg-[#11111B] accent-[#2563EB]"
          />
        </label>
      </div>
    </div>
  );
}
