// Human: One dropdown primitive shared by the explorer Filter and Sort controls.
// Agent: OWNS open state + outside-click + Escape; KEEPS listbox/option roles the old inline popovers had.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExplorerSelectMenuOption<T extends string> = {
  id: T;
  label: string;
};

export type ExplorerSelectMenuProps<T extends string> = {
  /** Human: Button caption, e.g. "Filter" or "Sort". */
  label: string;
  icon: ReactNode;
  options: readonly ExplorerSelectMenuOption<T>[];
  value: T;
  /**
   * Human: The neutral value. When `value` differs, the trigger shows an active chip so the
   * user can see a filter/sort is applied without opening the menu.
   */
  neutralValue: T;
  onChange: (value: T) => void;
  /** Human: Accessible name for the popover list itself. */
  menuLabel: string;
  menuClassName?: string;
};

// Human: Trigger + popover list with single-select semantics.
// Agent: CLOSES on outside mousedown and Escape; RESTORES focus to the trigger on Escape.
export function ExplorerSelectMenu<T extends string>({
  label,
  icon,
  options,
  value,
  neutralValue,
  onChange,
  menuLabel,
  menuClassName,
}: ExplorerSelectMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const activeLabel = options.find((option) => option.id === value)?.label ?? "";
  const isActive = value !== neutralValue;

  // Human: Dismiss on a click anywhere outside the trigger/menu cluster.
  // Agent: LISTENS document mousedown while open; WRITES open false.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      if (containerRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Human: Escape closes the menu and returns focus to the trigger for keyboard users.
  // Agent: LISTENS document keydown while open; STOPS the event reaching explorer shortcuts.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
          isActive
            ? "border-brand/35 bg-brand-weak text-brand"
            : "border-edge bg-panel text-ink hover:bg-surface",
          open && !isActive && "bg-surface",
        )}
      >
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        {label}
        {isActive ? (
          <span className="max-w-[9rem] truncate rounded-md bg-brand/12 px-1.5 py-0.5 text-[11px] font-semibold">
            {activeLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-label={menuLabel}
          className={cn(
            "absolute right-0 top-full z-30 mt-1.5 min-w-[13rem] overflow-hidden rounded-lg border border-edge bg-raised p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)]",
            menuClassName,
          )}
        >
          {options.map((option) => {
            const selected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                  selected
                    ? "font-semibold text-brand"
                    : "text-ink-muted hover:bg-surface hover:text-ink",
                )}
              >
                <Check
                  className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
