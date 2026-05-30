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
      <label htmlFor={fieldId} className="text-sm font-semibold text-[#1A1A1A]">
        {label}
      </label>
      <input
        id={fieldId}
        className={cn(
          "h-11 w-full rounded-lg border border-[#E5E7EB] bg-white px-4 text-sm text-[#1A1A1A]",
          "outline-none placeholder:text-[#888888] focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A]",
          className
        )}
        {...props}
      />
    </div>
  );
}
