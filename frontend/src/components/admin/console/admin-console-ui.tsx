// Human: Admin console UI primitives — 1:1 tokens from login-signup.pencil Admin Console frames.
// Agent: Tailwind-only; RENDERS layout shells; no API; USED by all /admin console panels.

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Human: Explorer content padding — Pencil uses 48px horizontal, 24px vertical gap. */
export const adminConsoleContentClassName = "flex flex-col gap-6";

/** Human: Page header — 28px (lg) or 24px (md) title per wireframe screen. */
export function AdminConsolePageHeader({
  title,
  description,
  actions,
  titleSize = "lg",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  titleSize?: "lg" | "md";
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1
          className={cn(
            "font-bold leading-tight text-[#1A1A1A]",
            titleSize === "lg" ? "text-[28px]" : "text-2xl",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function AdminConsoleOutlineButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function AdminConsolePrimaryButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Human: Underline tab bar — Global Policies / KMS & Keys, Settings tabs, etc. */
export function AdminConsoleUnderlineTabs({
  tabs,
  activeId,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      className="flex gap-8 border-b border-[#E5E7EB]"
      role="tablist"
      aria-label="Section tabs"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex min-w-[140px] flex-col items-center gap-3 px-2 pb-3 text-[15px] transition-colors",
              active ? "font-semibold text-[#2563EB]" : "font-normal text-[#666666] hover:text-[#1A1A1A]",
            )}
          >
            <span>{tab.label}</span>
            <span
              className={cn("h-0.5 w-full rounded-full", active ? "bg-[#2563EB]" : "bg-transparent")}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

/** Human: KPI card from metrics rows (icon chip top-right, value 26px bold). */
export function AdminConsoleMetricCard({
  label,
  value,
  detail,
  badge,
  icon: Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  badge?: { label: string; tone: "success" | "warning" | "danger" | "info" };
  icon: ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}) {
  const badgeToneClass =
    badge?.tone === "success"
      ? "bg-[#ECFDF5] text-[#10B981]"
      : badge?.tone === "warning"
        ? "bg-[#FFFBEB] text-[#D97706]"
        : badge?.tone === "danger"
          ? "bg-[#FEF2F2] text-[#EF4444]"
          : "bg-[#EFF6FF] text-[#2563EB]";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold text-[#666666]">{label}</p>
        {badge ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", badgeToneClass)}>
            {badge.label}
          </span>
        ) : (
          <div className={cn("rounded-lg p-2", iconBg)} aria-hidden>
            <Icon className={cn("size-4", iconColor)} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[26px] font-bold leading-none text-[#1A1A1A]">{value}</p>
        {detail ? <div className="text-xs font-medium text-[#666666]">{detail}</div> : null}
      </div>
    </div>
  );
}

export function AdminConsolePanel({
  title,
  subtitle,
  headerRight,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-6", className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-bold text-[#1A1A1A]">{title}</h2>
          {subtitle ? <p className="text-xs text-[#666666]">{subtitle}</p> : null}
        </div>
        {headerRight}
      </div>
      {children}
    </section>
  );
}

/** Human: Bordered data table matching admin console table containers. */
export function AdminConsoleTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: ReactNode[][];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[11px] font-bold uppercase tracking-wide text-[#888888]">
            {columns.map((col) => (
              <th key={col} className="px-4 py-3 font-bold">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="text-[#1A1A1A] hover:bg-[#F7F8FA]/60">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 align-middle">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Human: Settings panel — rounded-2xl white card with horizontal rows (System Settings wireframe). */
export function AdminConsoleSettingsPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-[#E5E7EB] bg-white p-8">
      {children}
    </div>
  );
}

/** Human: One settings row — 320px label block + control column. */
export function AdminConsoleSettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 border-b border-[#E5E7EB] pb-6 last:border-b-0 last:pb-0 lg:flex-row lg:gap-10">
      <div className="w-full max-w-[320px] shrink-0 flex-col gap-1">
        <p className="text-base font-semibold text-[#1A1A1A]">{title}</p>
        {description ? <p className="text-[13px] leading-relaxed text-[#666666]">{description}</p> : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Human: Field label + bordered input shell from settings wireframes. */
export function AdminConsoleField({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-[#666666]">{label}</label>
      <div className="flex h-11 items-center rounded-lg border border-[#E5E7EB] bg-white px-4">
        <span className="min-w-0 flex-1 truncate text-sm text-[#1A1A1A]">{value}</span>
        {suffix ? <span className="shrink-0 text-sm font-medium text-[#666666]">{suffix}</span> : null}
      </div>
    </div>
  );
}

/** Human: Avatar initials circle for user table rows. */
export function AdminConsoleUserAvatar({ initials }: { initials: string }) {
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white"
      aria-hidden
    >
      {initials}
    </div>
  );
}

/** Human: Role / severity pill in tables. */
export function AdminConsolePill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "danger" | "warning" | "primary";
}) {
  const toneClass =
    tone === "success"
      ? "bg-[#ECFDF5] text-[#10B981]"
      : tone === "danger"
        ? "bg-[#FEF2F2] text-[#EF4444]"
        : tone === "warning"
          ? "bg-[#FFFBEB] text-[#D97706]"
          : tone === "primary"
            ? "bg-[#DBEAFE] text-[#2563EB]"
            : "bg-[#F7F8FA] text-[#666666]";

  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-semibold", toneClass)}>
      {children}
    </span>
  );
}

/** Human: Resource allocation progress row from dashboard overview. */
export function AdminConsoleResourceRow({
  label,
  percent,
}: {
  label: string;
  percent: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-[#1A1A1A]">{label}</span>
        <span className="font-semibold text-[#2563EB]">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-[#E5E7EB]">
        <div
          className="h-full rounded-sm bg-[#2563EB] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
