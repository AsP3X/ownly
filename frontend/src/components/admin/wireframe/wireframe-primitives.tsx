// Human: Shared layout primitives for the admin dashboard wireframe (non-functional UI spec).
// Agent: RENDERS placeholder charts/tables; no API calls; used by AdminDashboardWireframePage tabs.

import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

/** Human: Small pill indicating wireframe / preview mode in the admin shell. */
export function WireframeBadge() {
  return (
    <Badge variant="secondary" className="font-normal text-xs uppercase tracking-wide">
      Wireframe preview
    </Badge>
  );
}

/** Human: Page title block with optional description and right-side actions. */
export function WireframePageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        {description ? <p className="text-sm text-neutral-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Human: KPI tile with trend indicator for dashboard grids. */
export function StatCard({
  label,
  value,
  hint,
  trend,
  trendLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
}) {
  const TrendIcon = trend === "down" ? TrendingDown : TrendingUp;
  return (
    <Card className="border-neutral-200 shadow-none">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 pt-0 text-xs text-neutral-500">
        <span>{hint}</span>
        {trend && trend !== "flat" && trendLabel ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              trend === "up" ? "text-emerald-600" : "text-rose-600",
            )}
          >
            <TrendIcon className="size-3.5" aria-hidden />
            {trendLabel}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Human: Segmented control for date ranges and metric filters (visual only). */
export function SegmentedFilter({
  options,
  active,
  onSelect,
  ariaLabel,
}: {
  options: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1"
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={active === opt.id}
          onClick={() => onSelect(opt.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            active === opt.id
              ? "bg-white text-blue-700 shadow-sm ring-1 ring-neutral-200"
              : "text-neutral-600 hover:text-neutral-900",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Human: CSS bar chart placeholder — wireframe does not ship a chart library yet. */
export function BarChartPlaceholder({
  title,
  subtitle,
  bars,
  className,
}: {
  title: string;
  subtitle?: string;
  bars: { label: string; value: number; color?: string }[];
  className?: string;
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <Card className={cn("border-neutral-200 shadow-none", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-neutral-900">{title}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-2 sm:gap-3" aria-hidden>
          {bars.map((bar) => (
            <div key={bar.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div
                className="w-full max-w-[48px] rounded-t-md bg-blue-600/80 transition-all"
                style={{
                  height: `${Math.round((bar.value / max) * 100)}%`,
                  backgroundColor: bar.color,
                }}
              />
              <span className="truncate text-[10px] text-neutral-500 sm:text-xs">{bar.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-neutral-400">Chart placeholder — connect to analytics API</p>
      </CardContent>
    </Card>
  );
}

/** Human: Donut-style ring for storage / quota breakdown wireframes. */
export function DonutPlaceholder({
  title,
  segments,
}: {
  title: string;
  segments: { label: string; percent: number; color: string }[];
}) {
  return (
    <Card className="border-neutral-200 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          className="mx-auto size-32 shrink-0 rounded-full border-[10px] border-neutral-100"
          style={{
            background: `conic-gradient(${segments
              .reduce<{ offset: number; parts: string[] }>(
                (acc, seg) => {
                  const start = acc.offset;
                  const end = acc.offset + seg.percent;
                  acc.parts.push(`${seg.color} ${start}% ${end}%`);
                  acc.offset = end;
                  return acc;
                },
                { offset: 0, parts: [] },
              )
              .parts.join(", ")})`,
          }}
          aria-hidden
        />
        <ul className="flex flex-1 flex-col gap-2 text-sm">
          {segments.map((seg) => (
            <li key={seg.label} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-neutral-700">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: seg.color }} aria-hidden />
                {seg.label}
              </span>
              <span className="tabular-nums text-neutral-500">{seg.percent}%</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Human: Simple data table shell with header row and sample body rows. */
export function WireframeTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: string[][];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full min-w-[640px] text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-4 py-3 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white">
          {rows.map((row, i) => (
            <tr key={i} className="text-neutral-800 hover:bg-neutral-50/80">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3">
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

/** Human: Settings row — label, help text, and control slot (switch, input, etc.). */
export function SettingsRow({
  label,
  description,
  children,
  disabled,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-neutral-100 py-4 sm:flex-row sm:items-center sm:justify-between",
        disabled && "opacity-50",
      )}
    >
      <div className="flex max-w-xl flex-col gap-1">
        <Label className="text-sm font-medium text-neutral-900">{label}</Label>
        {description ? <p className="text-xs text-neutral-500">{description}</p> : null}
      </div>
      <div className="shrink-0 sm:min-w-[200px] sm:text-right">{children}</div>
    </div>
  );
}

/** Human: Grouped settings section inside the Settings tab. */
export function SettingsSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
        {description ? <p className="text-sm text-neutral-500">{description}</p> : null}
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white px-4">{children}</div>
      {footer ? <div className="flex justify-end gap-2 pt-2">{footer}</div> : null}
    </section>
  );
}

/** Human: Toolbar with search + filter chips above tables. */
export function TableToolbar({
  searchPlaceholder,
  filters,
}: {
  searchPlaceholder: string;
  filters?: { label: string; active?: boolean }[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Input
        className="max-w-sm border-neutral-200"
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
      />
      <div className="flex flex-wrap gap-2">
        {filters?.map((f) => (
          <Button
            key={f.label}
            type="button"
            size="sm"
            variant={f.active ? "default" : "outline"}
            className={f.active ? "bg-blue-600 text-white hover:bg-blue-700" : "border-neutral-200"}
          >
            {f.label}
          </Button>
        ))}
        <Button type="button" size="sm" variant="outline" className="border-neutral-200">
          More filters…
        </Button>
      </div>
    </div>
  );
}

export { Button, Separator, Switch, Input };
