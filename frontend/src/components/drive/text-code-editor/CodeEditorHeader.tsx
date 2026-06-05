// Human: Tab bar and toolbar for the Ownly code editor — matches Pencil Editor Header (44px).
// Agent: RENDERS file tabs + word-wrap/search/settings controls; EMITS tab close and toolbar actions.

import { Code2, FileCode, Search, Settings, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import { editorTabIconClass } from "@/lib/text-code-editor/language";
import { cn } from "@/lib/utils";

export type CodeEditorHeaderProps = {
  tabs: FileItem[];
  activeFileId: string | null;
  wordWrap: boolean;
  searchOpen: boolean;
  settingsOpen: boolean;
  onSelectTab: (file: FileItem) => void;
  onCloseTab: (file: FileItem) => void;
  onToggleWordWrap: () => void;
  onToggleSearch: () => void;
  onToggleSettings: () => void;
};

export function CodeEditorHeader({
  tabs,
  activeFileId,
  wordWrap,
  searchOpen,
  settingsOpen,
  onSelectTab,
  onCloseTab,
  onToggleWordWrap,
  onToggleSearch,
  onToggleSettings,
}: CodeEditorHeaderProps) {
  const { theme } = useCodeEditorTheme();

  return (
    <header className={cn("flex h-11 shrink-0 items-center justify-between", theme.header)}>
      <div className="flex h-full min-w-0 items-center gap-px overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeFileId;
          return (
            <div
              key={tab.id}
              className={cn(
                "flex h-full shrink-0 items-center gap-2 px-4",
                active ? theme.tabActive : theme.tabInactive,
              )}
            >
              <button
                type="button"
                onClick={() => onSelectTab(tab)}
                className="flex min-w-0 items-center gap-2"
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
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab)}
                aria-label={`Close ${tab.name}`}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors",
                  theme.tabCloseHover,
                  active ? theme.tabCloseActive : theme.tabCloseInactive,
                )}
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex h-full shrink-0 items-center gap-4 px-4">
        <button
          type="button"
          onClick={onToggleWordWrap}
          aria-label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
          aria-pressed={wordWrap}
          className={cn(
            "flex size-4 items-center justify-center",
            theme.toolbarIcon,
            wordWrap && theme.toolbarIconActive,
          )}
        >
          <Code2 className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToggleSearch}
          aria-label={searchOpen ? "Close search" : "Open search"}
          aria-pressed={searchOpen}
          className={cn(
            "flex size-4 items-center justify-center",
            theme.toolbarIcon,
            searchOpen && theme.toolbarIconActive,
          )}
        >
          <Search className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToggleSettings}
          aria-label={settingsOpen ? "Close editor settings" : "Open editor settings"}
          aria-pressed={settingsOpen}
          className={cn(
            "flex size-4 items-center justify-center",
            theme.toolbarIcon,
            settingsOpen && theme.toolbarIconActive,
          )}
        >
          <Settings className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}
