// Human: Keyboard navigation for the explorer — arrows, Enter, Space, Backspace, Delete, Escape.
// Agent: LISTENS document keydown; MOVES DOM focus between [data-explorer-entry] nodes; no state re-render.

import { useCallback, useEffect, useRef, type RefObject } from "react";

export type ExplorerKeyboardNavOptions = {
  /** Human: Off while the explorer is loading, empty, or not the active nav. */
  enabled: boolean;
  /** Human: Number of rendered entries — resets focus when the listing changes. */
  entryCount: number;
  /** Human: Wrapper holding the entry nodes; queried for `[data-explorer-entry]`. */
  containerRef: RefObject<HTMLElement | null>;
  /** Human: List view is a single column; grid column count is measured from layout. */
  isListView: boolean;
  /** Human: Space — toggle selection of the entry at this index. */
  onToggleSelectIndex: (index: number) => void;
  /** Human: Escape — drop the whole selection. */
  onClearSelection: () => void;
  /** Human: Backspace — leave the current folder. */
  onNavigateUp: () => void;
  /** Human: Delete — request deletion of the current selection or focused entry. */
  onDeleteIndex: (index: number) => void;
};

/**
 * Human: Roving-focus keyboard control for the file browser.
 * Agent: Enter activates by clicking `[data-explorer-activate]`, so preview routing, card-select
 *        mode and drag-click suppression all reuse the existing handlers instead of being duplicated.
 */
export function useExplorerKeyboardNav({
  enabled,
  entryCount,
  containerRef,
  isListView,
  onToggleSelectIndex,
  onClearSelection,
  onNavigateUp,
  onDeleteIndex,
}: ExplorerKeyboardNavOptions) {
  const focusedIndexRef = useRef(-1);

  const getEntries = useCallback(
    () =>
      Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>("[data-explorer-entry]") ?? [],
      ),
    [containerRef],
  );

  // Human: Reset the roving index whenever the listing changes (folder change, search, filter).
  // Agent: READS entryCount only; avoids focusing a stale row after the list re-renders.
  useEffect(() => {
    focusedIndexRef.current = -1;
  }, [entryCount]);

  // Human: Move focus to an entry, clamped to the current list bounds.
  // Agent: FOCUSES the [data-explorer-activate] button; SCROLLS the entry just into view.
  const focusEntry = useCallback(
    (index: number) => {
      const entries = getEntries();
      if (entries.length === 0) return;
      const clamped = Math.max(0, Math.min(index, entries.length - 1));
      const entry = entries[clamped];
      focusedIndexRef.current = clamped;
      const target =
        entry.querySelector<HTMLElement>("[data-explorer-activate]") ?? entry;
      target.focus({ preventScroll: true });
      entry.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    [getEntries],
  );

  /**
   * Human: How many entries sit on one visual row, so Up/Down move a full row in grid view.
   * Agent: MEASURES how many leading entries share the first entry's top offset; list view is 1.
   */
  const measureColumnCount = useCallback(() => {
    if (isListView) return 1;
    const entries = getEntries();
    if (entries.length === 0) return 1;
    const firstTop = entries[0].getBoundingClientRect().top;
    let columns = 0;
    for (const entry of entries) {
      if (Math.abs(entry.getBoundingClientRect().top - firstTop) > 1) break;
      columns += 1;
    }
    return Math.max(1, columns);
  }, [getEntries, isListView]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      // Human: Never hijack typing, dialogs, or the browser's own modifier shortcuts.
      // Agent: MIRRORS the Ctrl+K guard in DriveCloudExplorer; Ctrl+A stays with DrivePage.
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      const isInsideDialog = target?.closest("[role='dialog'], dialog") !== null;
      if (isEditableTarget || isInsideDialog || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const entries = getEntries();
      if (entries.length === 0) return;

      const columns = measureColumnCount();
      const current = focusedIndexRef.current;
      // Human: First keypress enters the grid at the top-left rather than jumping mid-list.
      const start = current < 0 ? 0 : current;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          focusEntry(current < 0 ? 0 : start + 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          focusEntry(current < 0 ? 0 : start - 1);
          break;
        case "ArrowDown":
          event.preventDefault();
          focusEntry(current < 0 ? 0 : start + columns);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusEntry(current < 0 ? 0 : start - columns);
          break;
        case "Home":
          event.preventDefault();
          focusEntry(0);
          break;
        case "End":
          event.preventDefault();
          focusEntry(entries.length - 1);
          break;
        case " ":
        case "Spacebar": {
          if (current < 0) return;
          event.preventDefault();
          onToggleSelectIndex(current);
          break;
        }
        case "Backspace":
          event.preventDefault();
          onNavigateUp();
          break;
        case "Escape":
          onClearSelection();
          break;
        case "Delete":
          if (current < 0) return;
          event.preventDefault();
          onDeleteIndex(current);
          break;
        default:
          break;
      }

      // Human: Shift+Arrow extends the selection by picking up each entry it moves onto.
      // Agent: RUNS after the move so focusedIndexRef already points at the new entry.
      if (
        event.shiftKey &&
        (event.key === "ArrowRight" ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowDown" ||
          event.key === "ArrowUp")
      ) {
        onToggleSelectIndex(focusedIndexRef.current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    focusEntry,
    getEntries,
    measureColumnCount,
    onClearSelection,
    onDeleteIndex,
    onNavigateUp,
    onToggleSelectIndex,
  ]);

  return { focusEntry };
}
