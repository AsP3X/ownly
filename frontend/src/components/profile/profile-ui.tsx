// Human: Shared Tailwind primitives for the Account Settings & Security profile page.
// Agent: RENDERS Pencil login-signup.pen card shells, form fields, and stat rows; no API calls.

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Human: White bordered card — Pencil radius-xl + border-color on profile panels. */
export const profileCardClassName =
  "rounded-xl border border-[#E5E7EB] bg-white";

/** Human: Primary save CTA — Pencil Save Profile Button (accent fill, radius-lg). */
export const profilePrimaryButtonClassName =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60";

export function ProfileCard({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn(profileCardClassName, "p-6", className)}>
      {children}
    </section>
  );
}

/** Human: Card title block — 16px bold title + 13px secondary subtitle per Pencil card headers. */
export function ProfileCardHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-bold text-[#1A1A1A]">{title}</h2>
      {description ? (
        <p className="text-[13px] leading-relaxed text-[#666666]">{description}</p>
      ) : null}
    </div>
  );
}

export function ProfileDivider() {
  return <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />;
}

/** Human: Label above profile form controls — 13px semi-bold per Pencil field labels. */
export function ProfileFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-[#1A1A1A]">
      {children}
    </label>
  );
}

/** Human: Bordered text input — Pencil Input Box (radius-lg, 12×16 padding). */
export function ProfileTextInput({
  className,
  readOnly,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-lg border border-[#E5E7EB] bg-white px-4 text-sm text-[#1A1A1A] outline-none transition-colors",
        "placeholder:text-[#888888] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20",
        readOnly && "cursor-default bg-[#F7F8FA] text-[#666666]",
        className,
      )}
      readOnly={readOnly}
      {...props}
    />
  );
}

/** Human: Multi-line bio field — Pencil Bio Input Box (80px min height). */
export function ProfileTextarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full resize-y rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm text-[#1A1A1A] outline-none transition-colors",
        "placeholder:text-[#888888] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20",
        className,
      )}
      {...props}
    />
  );
}

/** Human: Summary stat row — label left, value right in summary card. */
export function ProfileStatRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-[#666666]">{label}</span>
      <span className={cn("text-[13px] font-semibold text-[#1A1A1A]", valueClassName)}>{value}</span>
    </div>
  );
}

