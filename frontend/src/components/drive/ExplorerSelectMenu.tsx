// Human: One dropdown primitive shared by the explorer Filter and Sort controls.
// Agent: OWNS open state + outside-click + Escape; KEEPS listbox/option roles the old inline popovers had.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { useMaxLgViewport } from "@/components/drive/ExplorerBreadcrumbs";
import { cn } from "@/lib/utils";

/** Human: Gutter kept between the viewport edges and the mobile popover. */
const MOBILE_MENU_GUTTER_PX = 12;

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
  const isMobile = useMaxLgViewport();
  // Human: Mobile popover geometry, measured from the trigger when the menu opens.
  const [mobileMenuStyle, setMobileMenuStyle] = useState<CSSProperties | null>(null);

  // Human: The triggers sit mid-row, so a right-aligned 240px menu ran off the left edge of a
  // narrow phone — and `min-width` beats `max-width`, so clamping the width alone cannot fix it.
  // Pinning to the viewport instead also escapes the scroll pane, which clips on both axes.
  // Agent: LAYOUT EFFECT so the menu never paints at the wrong spot; RECOMPUTES on resize/scroll.
  useLayoutEffect(() => {
    if (!open || !isMobile) {
      setMobileMenuStyle(null);
      return;
    }
    function position() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setMobileMenuStyle({
        position: "fixed",
        top: Math.round(rect.bottom + 6),
        left: MOBILE_MENU_GUTTER_PX,
        right: MOBILE_MENU_GUTTER_PX,
        minWidth: 0,
        maxHeight: `calc(100dvh - ${Math.round(rect.bottom + 6)}px - 5.5rem)`,
      });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [isMobile, open]);

  const activeLabel = options.find((option) => option.id === value)?.label ?? "";
  const isActive = value !== neutralValue;
  // Human: Below lg the caption and the active chip are hidden to keep the control row on one
  // line, so the accessible name has to carry both parts on its own.
  const triggerLabel = isActive ? `${label}: ${activeLabel}` : label;

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
        aria-label={triggerLabel}
        title={triggerLabel}
        className={cn(
          // Human: Icon-only below lg. With the caption and the active value spelled out, the
          // Sort trigger alone ran most of a phone's width and pushed the row into a third line.
          "flex h-9 items-center gap-2 rounded-lg border text-[13px] font-medium transition-colors",
          "max-lg:size-11 max-lg:justify-center max-lg:gap-0 max-lg:p-0 lg:px-3",
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
        <span className="max-lg:hidden" aria-hidden>
          {label}
        </span>
        {isActive ? (
          <span
            className="max-w-[9rem] truncate rounded-md bg-brand/12 px-1.5 py-0.5 text-[11px] font-semibold max-lg:hidden"
            aria-hidden
          >
            {activeLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-label={menuLabel}
          style={mobileMenuStyle ?? undefined}
          className={cn(
            "z-30 overflow-y-auto rounded-lg border border-edge bg-raised p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)]",
            // Human: Desktop anchors under the trigger; mobile is positioned from JS above, so it
            // must not also carry the absolute/min-width rules that caused the overflow.
            mobileMenuStyle
              ? "fixed"
              : cn("absolute right-0 top-full mt-1.5 min-w-[13rem]", menuClassName),
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
                  // Human: Fingers get taller rows — 30px options are hard to hit accurately.
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors touch:py-2.5",
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
