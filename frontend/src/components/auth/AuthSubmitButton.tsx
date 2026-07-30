// Human: Primary CTA for the auth forms — brand gradient, hover lift with a light sweep, inline spinner.
// Agent: RENDERS native submit button; disabled while loading or when the caller says the form is incomplete.

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthSubmitButtonProps = {
  children: string;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function AuthSubmitButton({
  children,
  loading,
  loadingLabel,
  disabled,
  className,
}: AuthSubmitButtonProps) {
  const label = loading ? (loadingLabel ?? children) : children;

  return (
    <button
      type="submit"
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      className={cn(
        "auth-cta group relative flex h-12 w-full items-center justify-center overflow-hidden rounded-xl px-4",
        "bg-gradient-to-br from-brand to-brand-hover text-sm font-bold text-brand-on",
        "shadow-lg shadow-brand/25 ring-1 ring-inset ring-white/15",
        "transition-[transform,box-shadow,filter] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/35 hover:brightness-105",
        "active:translate-y-0 active:scale-[0.985] active:shadow-md",
        "focus-visible:ring-4 focus-visible:ring-focus/40 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-55 disabled:shadow-none",
        className,
      )}
    >
      {/* Human: Diagonal light sweep on hover — the button's only idle-state flourish. */}
      <span
        className="auth-cta__sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-white/25 blur-md"
        aria-hidden
      />
      <span className="relative flex items-center justify-center gap-2">
        {loading ? <Loader2 className="auth-spinner size-4 shrink-0" aria-hidden /> : null}
        {label}
      </span>
    </button>
  );
}
