// Human: Inline footer copy with a primary-colored link — "Don't have an account? Sign up" pattern.
// Agent: RENDERS static prefix + Link; no side effects.

import { Link } from "react-router-dom";

type AuthFooterLinkProps = {
  prefix: string;
  linkLabel: string;
  to: string;
};

export function AuthFooterLink({ prefix, linkLabel, to }: AuthFooterLinkProps) {
  return (
    <p className="flex flex-wrap items-center justify-center gap-1 text-center text-sm text-[#666666]">
      <span>{prefix}</span>
      <Link to={to} className="font-semibold text-[#2563EB] hover:underline">
        {linkLabel}
      </Link>
    </p>
  );
}
