// Human: Shared layout primitives for the signed-in user profile page.
// Agent: Tailwind-only shells; RENDERS section cards; no API calls.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Human: Explorer content padding — matches admin console spacing tokens. */
export const profileContentClassName = "flex flex-col gap-6";

/** Human: Page header — title + optional description for profile sections. */
export function ProfilePageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h1 className="text-[28px] font-bold leading-tight text-[#1A1A1A]">{title}</h1>
      {description ? (
        <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">{description}</p>
      ) : null}
    </div>
  );
}

/** Human: White bordered card shell for one profile section (account, storage, security). */
export function ProfileSectionCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-[#1A1A1A]">{title}</h2>
        {description ? <p className="text-[13px] text-[#666666]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Human: Label + value row inside profile cards. */
export function ProfileDetailRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-[13px] font-medium text-[#666666]">{label}</span>
      {children ?? <span className="text-sm font-semibold text-[#1A1A1A]">{value}</span>}
    </div>
  );
}
