// Human: Password field with show/hide, caps-lock warning, and an optional live strength meter.
// Agent: LOCAL STATE for visibility + caps lock; WRITES type on the underlying input only.

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowBigUp, Eye, EyeOff, Lock } from "lucide-react";
import { AuthIconField } from "@/components/auth/AuthIconField";
import { cn } from "@/lib/utils";

type AuthPasswordFieldProps = {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  "aria-invalid"?: boolean;
  error?: string | null;
  success?: string | null;
  /** Rendered under the control — used for the strength meter on sign-up. */
  below?: ReactNode;
};

export function AuthPasswordField({
  label,
  id,
  value,
  onChange,
  autoComplete,
  required,
  placeholder,
  autoFocus,
  "aria-invalid": ariaInvalid,
  error,
  success,
  below,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // Human: Warn about caps lock before a failed sign-in wastes a round trip.
  // Agent: getModifierState is unavailable on some virtual keyboards — treat as "unknown" and stay quiet.
  function syncCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    if (typeof event.getModifierState !== "function") return;
    setCapsLock(event.getModifierState("CapsLock"));
  }

  return (
    <AuthIconField
      id={id}
      label={label}
      icon={Lock}
      type={visible ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyUp={syncCapsLock}
      onKeyDown={syncCapsLock}
      onBlur={() => setCapsLock(false)}
      autoComplete={autoComplete}
      required={required}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-invalid={ariaInvalid}
      error={error}
      success={success}
      trailing={
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Human: Caps-lock chip appears inside the field so it never shifts the layout. */}
          {capsLock ? (
            <span
              className="auth-pop hidden items-center gap-1 rounded-md bg-warn-weak px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-warn uppercase sm:inline-flex"
              title="Caps Lock is on"
            >
              <ArrowBigUp className="size-3" aria-hidden />
              Caps
            </span>
          ) : null}
          <button
            type="button"
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-lg text-ink-faint",
              "transition-[color,background-color,transform] duration-150 ease-out",
              "hover:bg-sunken hover:text-ink active:scale-90",
              "focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:outline-none",
            )}
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            tabIndex={-1}
          >
            {/* Human: Cross-fade the two glyphs rather than swapping them, so the toggle feels continuous. */}
            <span className="relative inline-flex size-[18px] items-center justify-center">
              <Eye
                className={cn(
                  "absolute size-[18px] transition-all duration-200 ease-out",
                  visible ? "scale-75 opacity-0" : "scale-100 opacity-100",
                )}
                aria-hidden
              />
              <EyeOff
                className={cn(
                  "absolute size-[18px] transition-all duration-200 ease-out",
                  visible ? "scale-100 opacity-100" : "scale-75 opacity-0",
                )}
                aria-hidden
              />
            </span>
          </button>
        </div>
      }
      below={
        <>
          {/* Human: Screen-reader + small-screen caps-lock notice (the in-field chip is sm and up). */}
          <div className={cn("auth-collapse sm:hidden", capsLock && "auth-collapse-open")}>
            <div>
              <p className="flex items-center gap-1.5 pt-1 text-xs font-medium text-warn">
                <ArrowBigUp className="size-3.5 shrink-0" aria-hidden />
                Caps Lock is on
              </p>
            </div>
          </div>
          <span className="sr-only" aria-live="polite">
            {capsLock ? "Caps Lock is on" : ""}
          </span>
          {below}
        </>
      }
    />
  );
}
