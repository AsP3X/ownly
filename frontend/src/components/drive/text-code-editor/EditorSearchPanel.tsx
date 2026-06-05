// Human: Floating find/replace panel — Pencil Search State overlay inside the editor pane.
// Agent: CONTROLLED query/replace inputs; EMITS navigation and replace actions to parent.

import { useEffect, useRef, type RefObject } from "react";
import {
  ChevronDown,
  ChevronUp,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import { cn } from "@/lib/utils";

export type EditorSearchPanelProps = {
  open: boolean;
  query: string;
  replaceValue: string;
  caseSensitive: boolean;
  matchCount: number;
  activeMatchIndex: number;
  replaceExpanded: boolean;
  onQueryChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onToggleCaseSensitive: () => void;
  onToggleReplaceExpanded: () => void;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  onClose: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  /** Human: Optional ref so the parent can focus find on Ctrl/Cmd+F when search is already open. */
  findInputRef?: RefObject<HTMLInputElement | null>;
};

export function EditorSearchPanel({
  open,
  query,
  replaceValue,
  caseSensitive,
  matchCount,
  activeMatchIndex,
  replaceExpanded,
  onQueryChange,
  onReplaceChange,
  onToggleCaseSensitive,
  onToggleReplaceExpanded,
  onPreviousMatch,
  onNextMatch,
  onClose,
  onReplaceOne,
  onReplaceAll,
  findInputRef,
}: EditorSearchPanelProps) {
  const { theme } = useCodeEditorTheme();
  const localFindInputRef = useRef<HTMLInputElement>(null);
  const queryInputRef = findInputRef ?? localFindInputRef;

  // Human: Focus find field whenever the panel opens — toolbar button or keyboard shortcut.
  // Agent: READS open; FOCUSES query input on next frame after mount/open transition.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      queryInputRef.current?.focus();
      queryInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, queryInputRef]);

  if (!open) return null;

  const counterLabel =
    matchCount > 0 ? `${activeMatchIndex + 1} of ${matchCount}` : query ? "0 of 0" : "";

  return (
    <div className={cn("absolute right-6 top-6 z-20 w-[380px] p-2.5", theme.panel)}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleReplaceExpanded}
            aria-label={replaceExpanded ? "Hide replace" : "Show replace"}
            aria-expanded={replaceExpanded}
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center",
              theme.panelText,
              "hover:opacity-80",
            )}
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", replaceExpanded && "rotate-180")}
              aria-hidden
            />
          </button>

          <div
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center justify-between rounded border px-2",
              theme.panelInputBorderFocus,
              theme.panelInputBg,
            )}
          >
            <input
              ref={queryInputRef}
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Find"
              aria-label="Find in file"
              className={cn(
                "min-w-0 flex-1 bg-transparent font-[Inconsolata] text-xs outline-none",
                theme.panelInputText,
                theme.panelInputPlaceholder,
              )}
            />
            <button
              type="button"
              onClick={onToggleCaseSensitive}
              aria-label={caseSensitive ? "Match case enabled" : "Match case disabled"}
              aria-pressed={caseSensitive}
              className={cn(
                "shrink-0 text-[11px]",
                caseSensitive ? "text-[#2563EB]" : theme.panelTitle,
              )}
            >
              Aa
            </button>
          </div>

          <span className={cn("shrink-0 text-[11px]", theme.panelText)}>{counterLabel}</span>

          <button
            type="button"
            onClick={onPreviousMatch}
            disabled={matchCount === 0}
            aria-label="Previous match"
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center hover:opacity-80 disabled:opacity-40",
              theme.panelText,
            )}
          >
            <ChevronUp className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onNextMatch}
            disabled={matchCount === 0}
            aria-label="Next match"
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center hover:opacity-80 disabled:opacity-40",
              theme.panelText,
            )}
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center hover:opacity-80",
              theme.panelText,
            )}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        {replaceExpanded ? (
          <div className="flex items-center gap-2">
            <span className="size-3.5 shrink-0" aria-hidden />
            <div
              className={cn(
                "flex h-7 min-w-0 flex-1 items-center rounded border px-2",
                theme.panelInputBorder,
                theme.panelInputBg,
              )}
            >
              <input
                type="text"
                value={replaceValue}
                onChange={(event) => onReplaceChange(event.target.value)}
                placeholder="Replace"
                aria-label="Replace with"
                className={cn(
                  "min-w-0 flex-1 bg-transparent font-[Inconsolata] text-xs outline-none",
                  theme.panelInputTextMuted,
                  theme.panelInputPlaceholder,
                )}
              />
            </div>
            <button
              type="button"
              onClick={onReplaceOne}
              disabled={matchCount === 0}
              aria-label="Replace current match"
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center hover:opacity-80 disabled:opacity-40",
                theme.panelText,
              )}
            >
              <Replace className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onReplaceAll}
              disabled={matchCount === 0}
              aria-label="Replace all matches"
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center hover:opacity-80 disabled:opacity-40",
                theme.panelText,
              )}
            >
              <ReplaceAll className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
