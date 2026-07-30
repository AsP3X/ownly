// Human: Labeled text field with a leading icon — the shared input for every auth form row.
// Agent: FORWARDS native input props; trailing slot for toggles; error/success/below slots render under the control.

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertCircle, Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthIconFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: LucideIcon;
  trailing?: ReactNode;
  /** Inline validation message — also marks the control invalid for assistive tech. */
  error?: string | null;
  /** Inline confirmation message (e.g. "Passwords match"). */
  success?: string | null;
  /** Extra content under the control, e.g. the password strength meter. */
  below?: ReactNode;
};

export function AuthIconField({
  label,
  icon: Icon,
  trailing,
  error,
  success,
  below,
  className,
  id,
  ...props
}: AuthIconFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? `${label.toLowerCase().replace(/\s+/g, "-")}-${generatedId}`;
  const messageId = `${fieldId}-message`;
  const invalid = Boolean(error) || props["aria-invalid"] === true;
  const message = error ?? success ?? null;

  return (
    <div className="group/field flex flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className={cn(
          "text-xs font-semibold tracking-wide transition-colors duration-150",
          invalid
            ? "text-danger"
            : "text-ink-muted group-focus-within/field:text-brand",
        )}
      >
        {label}
      </label>

      <div
        className={cn(
          // Human: h-12 keeps the tap target comfortable on phones; the field lifts a hair on focus.
          "relative flex h-12 w-full items-center gap-3 rounded-xl border px-3.5",
          "transition-[border-color,box-shadow,background-color,transform] duration-200 ease-out",
          "border-edge bg-sunken/50 hover:border-edge-strong",
          "focus-within:-translate-y-px focus-within:border-brand focus-within:bg-panel focus-within:ring-4 focus-within:ring-focus/15",
          invalid &&
            "border-danger bg-danger-weak/40 focus-within:border-danger focus-within:ring-danger/20",
        )}
      >
        <Icon
          className={cn(
            "size-[18px] shrink-0 transition-[color,transform] duration-200 ease-out",
            invalid
              ? "text-danger"
              : "text-ink-faint group-focus-within/field:scale-110 group-focus-within/field:text-brand",
          )}
          aria-hidden
        />
        {/* Agent: props spread first so the computed id/invalid/describedby below always win. */}
        <input
          {...props}
          id={fieldId}
          aria-invalid={invalid || undefined}
          aria-describedby={message ? messageId : props["aria-describedby"]}
          className={cn(
            // Human: text-base (16px) avoids iOS Safari auto-zoom on focus; md restores compact desktop type.
            "min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint/80 md:text-sm",
            className,
          )}
        />
        {trailing}
      </div>

      {/* Human: Messages animate open so the form never jumps when validation appears. */}
      <div className={cn("auth-collapse", message && "auth-collapse-open")}>
        <div>
          <p
            id={messageId}
            role={error ? "alert" : undefined}
            className={cn(
              "flex items-center gap-1.5 pt-1 text-xs font-medium",
              error ? "text-danger" : "text-ok",
            )}
          >
            {message ? (
              error ? (
                <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <Check className="size-3.5 shrink-0" aria-hidden />
              )
            ) : null}
            {message}
          </p>
        </div>
      </div>

      {below}
    </div>
  );
}
