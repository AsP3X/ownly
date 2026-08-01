// Human: Time and severity formatting shared by the audit table and detail drawer.
// Agent: PURE functions — unit tested in audit-log-format.test.ts.

import type { AdminAuditSeverity } from "@/api/client";

/** Human: Pill tone per severity, matching AdminConsolePill's tone vocabulary. */
export function severityTone(
  severity: AdminAuditSeverity,
): "danger" | "warning" | "primary" | "neutral" {
  switch (severity) {
    case "Critical":
      return "danger";
    case "Warning":
      return "warning";
    case "Notice":
      return "primary";
    default:
      return "neutral";
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Human: Compact relative age for the timestamp column — "just now", "4m ago", "3d ago".
// Agent: Sub-minute collapses to "just now"; beyond 30 days falls back to a date.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";

  const delta = now - parsed;
  if (delta < 0) return "just now";
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;

  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Human: Full local timestamp for hover titles and the drawer.
// Agent: Server sends RFC 3339 UTC; the browser renders it in the operator's zone.
export function absoluteTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

// Human: Pretty-print the context JSONB for the drawer, tolerating non-object values.
export function formatContext(context: unknown): string | null {
  if (context == null) return null;
  try {
    return JSON.stringify(context, null, 2);
  } catch {
    return String(context);
  }
}
