// Human: Label + text input row matching Pencil field groups (44px height, lg radius, border stroke).
// Agent: FORWARDS native input props; optional colSpan for database grid layouts.

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SetupFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  colSpan?: 1 | 2;
};

export function SetupField({ label, colSpan = 1, className, id, ...props }: SetupFieldProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className={cn("flex flex-col gap-2", colSpan === 2 && "col-span-2")}>
      <label htmlFor={fieldId} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={fieldId}
        className={cn(
          // Human: text-base on mobile prevents iOS Safari focus zoom; md:text-sm for desktop density.
          "h-11 w-full rounded-lg border border-edge bg-panel px-4 text-base text-ink md:text-sm",
          "outline-none placeholder:text-ink-faint focus:border-ink focus:ring-1 focus:ring-ink",
          className
        )}
        {...props}
      />
    </div>
  );
}
