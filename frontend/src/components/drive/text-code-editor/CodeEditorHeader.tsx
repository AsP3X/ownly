// Human: Tab bar + modern editor toolbar — find, replace, go-to-line, format, wrap, minimap, settings.
// Agent: RENDERS file tabs and tool buttons; EMITS tab and toolbar actions to the dialog controller.

import {
  AlignLeft,
  Command,
  FileCode,
  Map as MapIcon,
  Search,
  Settings,
  TextCursorInput,
  WrapText,
  X,
} from "lucide-react";
import type { FileItem } from "@/api/client";
import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import { editorTabIconClass } from "@/lib/text-code-editor/language";
import { cn } from "@/lib/utils";

export type CodeEditorHeaderProps = {
  tabs: FileItem[];
  activeFileId: string | null;
  dirtyTabIds: Set<string>;
  wordWrap: boolean;
  minimap: boolean;
  settingsOpen: boolean;
  readOnly?: boolean;
  onSelectTab: (file: FileItem) => void;
  onCloseTab: (file: FileItem) => void;
  onToggleWordWrap: () => void;
  onToggleMinimap: () => void;
  onToggleSettings: () => void;
  onFind: () => void;
  onReplace: () => void;
  onGoToLine: () => void;
  onFormat: () => void;
  onCommandPalette: () => void;
};

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
  disabled,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { theme } = useCodeEditorTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "flex size-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40",
        theme.toolbarIcon,
        pressed && theme.toolbarIconActive,
        "hover:bg-black/5 dark:hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}

export function CodeEditorHeader({
  tabs,
  activeFileId,
  dirtyTabIds,
  wordWrap,
  minimap,
  settingsOpen,
  readOnly = false,
  onSelectTab,
  onCloseTab,
  onToggleWordWrap,
  onToggleMinimap,
  onToggleSettings,
  onFind,
  onReplace,
  onGoToLine,
  onFormat,
  onCommandPalette,
}: CodeEditorHeaderProps) {
  const { theme } = useCodeEditorTheme();

  return (
    <header className={cn("flex h-12 shrink-0 items-center justify-between border-b", theme.header)}>
      <div className="flex h-full min-w-0 flex-1 items-center gap-px overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeFileId;
          const dirty = dirtyTabIds.has(tab.id);
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex h-full shrink-0 items-center gap-2 border-r px-3",
                active ? theme.tabActive : theme.tabInactive,
              )}
            >
              <button
                type="button"
                onClick={() => onSelectTab(tab)}
                className="flex min-w-0 max-w-[12rem] items-center gap-2"
              >
                <FileCode
                  className={cn(
                    "size-3.5 shrink-0",
                    editorTabIconClass(tab.name, active, theme.id),
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "truncate text-[13px]",
                    active ? theme.tabTextActive : theme.tabTextInactive,
                  )}
                >
                  {tab.name}
                </span>
                {dirty ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-[#F59E0B]"
                    title="Unsaved changes"
                    aria-label="Unsaved changes"
                  />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab)}
                aria-label={`Close ${tab.name}`}
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors",
                  theme.tabCloseHover,
                  active ? theme.tabCloseActive : theme.tabCloseInactive,
                )}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex h-full shrink-0 items-center gap-0.5 border-l px-2 sm:gap-1 sm:px-3">
        <ToolbarButton label="Find (⌘F)" onClick={onFind}>
          <Search className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Replace (⌘⌥F)" onClick={onReplace} disabled={readOnly}>
          <TextCursorInput className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Go to line (⌘G)" onClick={onGoToLine}>
          <AlignLeft className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Format document (⇧⌥F)" onClick={onFormat} disabled={readOnly}>
          <span className="text-[11px] font-bold leading-none">Fmt</span>
        </ToolbarButton>
        <span className={cn("mx-1 hidden h-4 w-px sm:block", theme.id === "dark" ? "bg-[#313244]" : "bg-[#E5E7EB]")} />
        <ToolbarButton
          label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
          pressed={wordWrap}
          onClick={onToggleWordWrap}
        >
          <WrapText className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label={minimap ? "Hide minimap" : "Show minimap"}
          pressed={minimap}
          onClick={onToggleMinimap}
        >
          <MapIcon className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Command palette (F1)" onClick={onCommandPalette}>
          <Command className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label={settingsOpen ? "Close settings" : "Editor settings"}
          pressed={settingsOpen}
          onClick={onToggleSettings}
        >
          <Settings className="size-4" aria-hidden />
        </ToolbarButton>
      </div>
    </header>
  );
}
