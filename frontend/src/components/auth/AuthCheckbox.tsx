// Human: Themed checkbox for "Remember me" and the terms row — animated tick, real native input underneath.
// Agent: KEEPS the native <input type="checkbox"> for a11y/form semantics; the visual box is decorative.

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
};

export function AuthCheckbox({ checked, onChange, children, className }: AuthCheckboxProps) {
  return (
    <label
      className={cn(
        // Human: The 18px box is the visual, but the whole label row is the tap target — touch:min-h-11
        // gives it a finger-sized band without moving anything on desktop.
        "group/checkbox flex min-h-5 cursor-pointer items-center gap-2.5 text-sm text-ink-muted select-none touch:min-h-11",
        "transition-colors duration-150 hover:text-ink",
        className,
      )}
    >
      {/*
       * Human: The native input *is* the box — styling it directly (rather than hiding it behind a
       * decorative span) keeps it in the accessibility tree and focusable by keyboard.
       */}
      <span className="relative inline-flex size-[18px] shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={cn(
            // Human: 6px radius — the shared rounded-md (8px) reads as a circle at this size.
            "peer size-[18px] cursor-pointer appearance-none rounded-[6px] border border-edge-strong bg-panel",
            "transition-[background-color,border-color,transform,box-shadow] duration-200 ease-out",
            "checked:border-brand checked:bg-brand checked:shadow-sm checked:shadow-brand/30",
            "focus-visible:ring-4 focus-visible:ring-focus/25 focus-visible:outline-none",
            "group-hover/checkbox:scale-105 group-active/checkbox:scale-95",
          )}
        />
        <Check
          className={cn(
            "pointer-events-none absolute size-3 text-brand-on transition-all duration-150 ease-out",
            "scale-50 opacity-0 peer-checked:scale-100 peer-checked:opacity-100",
          )}
          strokeWidth={3.5}
          aria-hidden
        />
      </span>
      <span>{children}</span>
    </label>
  );
}
