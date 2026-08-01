// Human: Detail drawer for one audit event — surfaces context JSON and user agent, stored but never shown before.
// Agent: RENDERS selected AdminAuditLogRow; Escape closes; copy button writes JSON to clipboard.

import { useEffect, useState } from "react";
import { Copy, X } from "lucide-react";
import type { AdminAuditLogRow } from "@/api/client";
import { AdminConsolePill } from "@/components/admin/console/admin-console-ui";
import {
  absoluteTime,
  formatContext,
  relativeTime,
  severityTone,
} from "@/components/admin/console/audit-log-format";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-edge py-2.5 last:border-b-0">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="break-words text-xs text-ink">{value}</dd>
    </div>
  );
}

export function AuditEventDrawer({
  row,
  onClose,
}: {
  row: AdminAuditLogRow | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!row) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [row, onClose]);

  // Human: Reset the copied acknowledgement when a different event is opened.
  useEffect(() => setCopied(false), [row?.id]);

  if (!row) return null;

  const context = formatContext(row.context);

  async function copyEvent() {
    if (!row) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Audit event detail">
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="flex-1 bg-black/30"
      />
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-edge bg-panel p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-xs font-semibold text-brand">{row.action}</p>
            <p className="text-sm font-semibold text-ink">{row.label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <AdminConsolePill tone={severityTone(row.severity)}>{row.severity}</AdminConsolePill>
          <AdminConsolePill>{row.category}</AdminConsolePill>
        </div>

        <dl className="mt-4 flex flex-col">
          <DetailRow
            label="Timestamp"
            value={
              <>
                {absoluteTime(row.timestamp)}{" "}
                <span className="text-ink-faint">({relativeTime(row.timestamp)})</span>
              </>
            }
          />
          <DetailRow label="Actor" value={row.actor_email ?? "system"} />
          {row.actor_id ? (
            <DetailRow
              label="Actor ID"
              value={<span className="font-mono">{row.actor_id}</span>}
            />
          ) : null}
          <DetailRow
            label="Resource"
            value={
              row.resource_type || row.resource_id ? (
                <span className="font-mono">
                  {row.resource_type ?? "—"}
                  {row.resource_id ? `: ${row.resource_id}` : ""}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow
            label="IP address"
            value={<span className="font-mono">{row.ip ?? "—"}</span>}
          />
          <DetailRow label="User agent" value={row.user_agent || "—"} />
          <DetailRow label="Event ID" value={<span className="font-mono">{row.id}</span>} />
        </dl>

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Context</p>
            <button
              type="button"
              onClick={() => void copyEvent()}
              className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] font-semibold text-ink-muted hover:text-ink"
            >
              <Copy className="size-3" aria-hidden />
              {copied ? "Copied" : "Copy event"}
            </button>
          </div>
          {context ? (
            <pre className="overflow-x-auto rounded-lg border border-edge bg-surface p-3 text-[11px] leading-relaxed text-ink">
              {context}
            </pre>
          ) : (
            <p className="rounded-lg border border-edge bg-surface p-3 text-xs text-ink-faint">
              No additional context was recorded for this event.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
