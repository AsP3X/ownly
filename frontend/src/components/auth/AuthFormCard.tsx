// Human: Centered auth card shell — logo, titles, form body, and optional footer from the Pencil wireframes.
// Agent: RENDERS layout slots only; styling uses Tailwind tokens aligned to login-signup.pencil variables.

import type { ReactNode } from "react";
import { Cloud } from "lucide-react";

type AuthFormCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthFormCard({ title, subtitle, children, footer }: AuthFormCardProps) {
  return (
    <div className="w-full max-w-[480px] rounded-2xl border border-[#E5E7EB] bg-white p-12 shadow-[0_12px_32px_#00000014]">
      {/* Human: Brand row — cloud icon + Ownly wordmark per design Logo Header */}
      <div className="mb-6 flex items-center justify-center gap-2">
        <Cloud className="size-7 shrink-0 text-[#2563EB]" aria-hidden />
        <span className="text-xl font-bold tracking-tight text-[#1A1A1A]">Ownly</span>
      </div>

      {/* Human: Title block — 24px bold headline + 14px muted subcopy */}
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">{title}</h1>
        <p className="text-sm text-[#666666]">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-6">{children}</div>

      {footer ? <div className="mt-6">{footer}</div> : null}
    </div>
  );
}
