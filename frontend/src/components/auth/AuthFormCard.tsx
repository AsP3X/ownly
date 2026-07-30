// Human: Frosted auth card — brand row (small screens), titles, form body, and optional footer.
// Agent: RENDERS layout slots only; colours come from the drive semantic tokens so dark mode follows the app theme.

import type { CSSProperties, ReactNode } from "react";
import { AuthBrandMark } from "@/components/auth/AuthBrandMark";

type AuthFormCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthFormCard({ title, subtitle, children, footer }: AuthFormCardProps) {
  return (
    <div
      className={[
        "auth-card-enter relative w-full overflow-hidden rounded-3xl",
        "border border-edge/70 bg-panel/80 backdrop-blur-xl supports-backdrop-filter:bg-panel/70",
        "p-6 shadow-[0_24px_70px_-20px_rgba(15,23,42,0.35)] sm:p-8 lg:p-10",
        "dark:bg-panel/75 dark:shadow-[0_28px_80px_-24px_rgba(0,0,0,0.75)]",
      ].join(" ")}
    >
      {/* Human: Hairline of brand light across the top edge — gives the glass card a lit rim. */}
      <span
        className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent"
        aria-hidden
      />

      {/* Human: The brand column already carries the logo on lg+, so only small screens repeat it. */}
      <div className="auth-enter mb-6 flex justify-center lg:hidden">
        <AuthBrandMark size="sm" />
      </div>

      <div
        className="auth-enter mb-7 flex flex-col gap-2 text-center lg:text-left"
        style={{ "--auth-i": 1 } as CSSProperties}
      >
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[26px]">{title}</h1>
        <p className="text-sm leading-relaxed text-ink-muted">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-6">{children}</div>

      {footer ? (
        <div
          className="auth-enter mt-7 border-t border-hairline pt-5"
          style={{ "--auth-i": 6 } as CSSProperties}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
