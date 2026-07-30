// Human: Inline footer copy with a brand link — "Don't have an account? Sign up" pattern.
// Agent: RENDERS static prefix + Link; underline is a transform so it wipes in instead of blinking on.

import { Link } from "react-router-dom";

type AuthFooterLinkProps = {
  prefix: string;
  linkLabel: string;
  to: string;
};

export function AuthFooterLink({ prefix, linkLabel, to }: AuthFooterLinkProps) {
  return (
    <p className="flex flex-wrap items-center justify-center gap-1 text-center text-sm text-ink-muted">
      <span>{prefix}</span>
      <Link
        to={to}
        className="group relative font-semibold text-brand transition-colors duration-150 hover:text-brand-hover focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:outline-none"
      >
        {linkLabel}
        <span
          className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-200 ease-out group-hover:origin-left group-hover:scale-x-100 group-focus-visible:scale-x-100"
          aria-hidden
        />
      </Link>
    </p>
  );
}
