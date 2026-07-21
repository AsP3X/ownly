// Human: Labeled text field with a leading Lucide icon — matches Pencil input groups (mail, user, lock).
// Agent: FORWARDS native input props; optional trailing slot for password visibility toggle.

import type { InputHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthIconFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: LucideIcon;
  trailing?: ReactNode;
};

export function AuthIconField({
  label,
  icon: Icon,
  trailing,
  className,
  id,
  ...props
}: AuthIconFieldProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-xs font-semibold text-[#666666]">
        {label}
      </label>
      <div
        className={cn(
          "flex h-11 w-full items-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-4",
          "focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/20",
          props["aria-invalid"] && "border-red-500 focus-within:border-red-500 focus-within:ring-red-500/20"
        )}
      >
        <Icon className="size-4 shrink-0 text-[#888888]" aria-hidden />
        <input
          id={fieldId}
          className={cn(
            // Human: text-base (16px) avoids iOS Safari auto-zoom on focus; md restores compact desktop type.
            "min-w-0 flex-1 border-0 bg-transparent text-base text-[#1A1A1A] outline-none placeholder:text-[#888888] md:text-sm",
            className
          )}
          {...props}
        />
        {trailing}
      </div>
    </div>
  );
}
