// Human: Label + input row for the setup wizard — hairline border, brand ring on focus, nothing else.
// Agent: FORWARDS native input props; optional hint/error line; colSpan for the database grid.

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type SetupFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  colSpan?: 1 | 2;
  /** Human: Inline validation message; also marks the control invalid for assistive tech. */
  error?: string | null;
  /** Human: Quiet helper line under the control (units, defaults, where a value comes from). */
  hint?: ReactNode;
  /** Human: Control rendered inside the field box, e.g. a show/hide password toggle. */
  trailing?: ReactNode;
};

export function SetupField({
  label,
  colSpan = 1,
  error,
  hint,
  trailing,
  className,
  id,
  ...props
}: SetupFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? `setup-${label.toLowerCase().replace(/\s+/g, "-")}-${generatedId}`;
  const messageId = `${fieldId}-message`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", colSpan === 2 && "col-span-2")}>
      <label htmlFor={fieldId} className="text-[13px] font-medium text-ink">
        {label}
      </label>

      <div
        className={cn(
          // Human: 44px on phones so the field is a comfortable tap target; 40px from sm up.
          "flex h-11 w-full items-center gap-1 rounded-md border bg-panel px-3 sm:h-10",
          "transition-[border-color,box-shadow] duration-150",
          "focus-within:border-brand focus-within:ring-2 focus-within:ring-focus/20",
          error ? "border-danger" : "border-edge",
        )}
      >
        <input
          {...props}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : props["aria-describedby"]}
          className={cn(
            // Human: text-base on mobile prevents iOS Safari focus zoom; md:text-sm for desktop density.
            "min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint md:text-sm",
            className,
          )}
        />
        {trailing}
      </div>

      {error ? (
        <p id={messageId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs leading-relaxed text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
