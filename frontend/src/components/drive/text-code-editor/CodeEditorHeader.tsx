// Human: Tab bar and toolbar for the Ownly code editor — matches Pencil Editor Header (44px).
// Agent: RENDERS file tabs + word-wrap/search/settings controls; EMITS tab close and toolbar actions.

import { Code2, FileCode, Search, Settings, X } from "lucide-react";
import type { FileItem } from "@/api/client";
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
  return (
    <header className="flex h-11 shrink-0 items-center justify-between bg-[#151521]">
      <div className="flex h-full min-w-0 items-center gap-px overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeFileId;
          return (
            <div
              key={tab.id}
              className={cn(
                "flex h-full shrink-0 items-center gap-2 px-4",
                active ? "bg-[#1E1E2E]" : "bg-[#14141F]",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectTab(tab)}
                className="flex min-w-0 items-center gap-2"
              >
                <FileCode
                  className={cn("size-3.5 shrink-0", editorTabIconClass(tab.name, active))}
                  aria-hidden
                />
                <span
                  className={cn(
                    "truncate text-[13px]",
                    active ? "font-medium text-[#CDD6F4]" : "font-normal text-[#565F89]",
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
                  "flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-white/5",
                  active ? "text-[#7F848E]" : "text-[#3F445B]",
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
            "flex size-4 items-center justify-center text-[#A6ADC8] transition-colors hover:text-[#CDD6F4]",
            wordWrap && "text-[#2563EB]",
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
            "flex size-4 items-center justify-center text-[#A6ADC8] transition-colors hover:text-[#CDD6F4]",
            searchOpen && "text-[#2563EB]",
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
            "flex size-4 items-center justify-center text-[#A6ADC8] transition-colors hover:text-[#CDD6F4]",
            settingsOpen && "text-[#2563EB]",
          )}
        >
          <Settings className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}
