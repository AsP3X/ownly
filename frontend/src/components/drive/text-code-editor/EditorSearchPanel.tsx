// Human: Floating find/replace panel — Pencil Search State overlay inside the editor pane.
// Agent: CONTROLLED query/replace inputs; EMITS navigation and replace actions to parent.

import {
  ChevronDown,
  ChevronUp,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
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
}: EditorSearchPanelProps) {
  if (!open) return null;

  const counterLabel =
    matchCount > 0 ? `${activeMatchIndex + 1} of ${matchCount}` : query ? "0 of 0" : "";

  return (
    <div className="absolute right-6 top-6 z-20 w-[380px] rounded-lg border border-[#313244] bg-[#151521] p-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleReplaceExpanded}
            aria-label={replaceExpanded ? "Hide replace" : "Show replace"}
            aria-expanded={replaceExpanded}
            className="flex size-3.5 shrink-0 items-center justify-center text-[#A6ADC8] hover:text-[#CDD6F4]"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", replaceExpanded && "rotate-180")}
              aria-hidden
            />
          </button>

          <div className="flex h-7 min-w-0 flex-1 items-center justify-between rounded border border-[#2563EB] bg-[#11111B] px-2">
            <input
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Find"
              aria-label="Find in file"
              className="min-w-0 flex-1 bg-transparent font-[Inconsolata] text-xs text-[#CDD6F4] outline-none placeholder:text-[#565F89]"
            />
            <button
              type="button"
              onClick={onToggleCaseSensitive}
              aria-label={caseSensitive ? "Match case enabled" : "Match case disabled"}
              aria-pressed={caseSensitive}
              className={cn(
                "shrink-0 text-[11px]",
                caseSensitive ? "text-[#2563EB]" : "text-[#565F89]",
              )}
            >
              Aa
            </button>
          </div>

          <span className="shrink-0 text-[11px] text-[#A6ADC8]">{counterLabel}</span>

          <button
            type="button"
            onClick={onPreviousMatch}
            disabled={matchCount === 0}
            aria-label="Previous match"
            className="flex size-3.5 shrink-0 items-center justify-center text-[#A6ADC8] hover:text-[#CDD6F4] disabled:opacity-40"
          >
            <ChevronUp className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onNextMatch}
            disabled={matchCount === 0}
            aria-label="Next match"
            className="flex size-3.5 shrink-0 items-center justify-center text-[#A6ADC8] hover:text-[#CDD6F4] disabled:opacity-40"
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="flex size-3.5 shrink-0 items-center justify-center text-[#A6ADC8] hover:text-[#CDD6F4]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        {replaceExpanded ? (
          <div className="flex items-center gap-2">
            <span className="size-3.5 shrink-0" aria-hidden />
            <div className="flex h-7 min-w-0 flex-1 items-center rounded border border-[#313244] bg-[#11111B] px-2">
              <input
                type="text"
                value={replaceValue}
                onChange={(event) => onReplaceChange(event.target.value)}
                placeholder="Replace"
                aria-label="Replace with"
                className="min-w-0 flex-1 bg-transparent font-[Inconsolata] text-xs text-[#A6ADC8] outline-none placeholder:text-[#565F89]"
              />
            </div>
            <button
              type="button"
              onClick={onReplaceOne}
              disabled={matchCount === 0}
              aria-label="Replace current match"
              className="flex size-3.5 shrink-0 items-center justify-center text-[#A6ADC8] hover:text-[#CDD6F4] disabled:opacity-40"
            >
              <Replace className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onReplaceAll}
              disabled={matchCount === 0}
              aria-label="Replace all matches"
              className="flex size-3.5 shrink-0 items-center justify-center text-[#A6ADC8] hover:text-[#CDD6F4] disabled:opacity-40"
            >
              <ReplaceAll className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
