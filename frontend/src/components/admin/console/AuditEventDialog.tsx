// Human: Detail dialog for one audit event — surfaces context JSON and user agent, stored but never shown before.
// Agent: RENDERS selected AdminAuditLogRow in the shared admin dialog shell; Escape/overlay close via Dialog primitive.

import { useEffect, useState } from "react";
import { Copy, ScrollText, X } from "lucide-react";
import type { AdminAuditLogRow } from "@/api/client";
import { AdminConsolePill } from "@/components/admin/console/admin-console-ui";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  absoluteTime,
  formatContext,
  relativeTime,
  severityTone,
} from "@/components/admin/console/audit-log-format";

// Human: sm:max-w is set explicitly — DialogContent's base carries sm:max-w-sm, which an unprefixed
// max-w cannot override at >=640px viewports, leaving the dialog stuck at 384px.
const DIALOG_SHELL_CLASS =
  "flex max-h-[90vh] w-[calc(100%-1rem)] max-w-[640px] flex-col gap-0 overflow-hidden rounded-2xl " +
  "border border-edge bg-panel p-0 shadow-[0_12px_32px_-4px_#00000026] sm:w-full sm:max-w-[640px]";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-edge py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm text-ink sm:text-right">{value}</dd>
    </div>
  );
}

export function AuditEventDialog({
  row,
  onClose,
}: {
  row: AdminAuditLogRow | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Human: Retains the event while the dialog animates out, so closing does not flash an empty box.
  // Agent: `row` goes null the instant the panel clears its selection; the exit animation still runs.
  const [lastRow, setLastRow] = useState<AdminAuditLogRow | null>(row);

  useEffect(() => {
    if (row) setLastRow(row);
  }, [row]);

  // Human: Reset the copied acknowledgement when a different event is opened.
  useEffect(() => setCopied(false), [row?.id]);

  const shown = row ?? lastRow;
  const context = shown ? formatContext(shown.context) : null;

  async function copyEvent() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(shown, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={row != null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={DIALOG_SHELL_CLASS}
        overlayClassName="bg-black/30"
      >
        {shown ? (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-edge px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-weak">
                  <ScrollText className="size-5 text-brand" aria-hidden />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate font-mono text-sm font-bold text-brand">
                    {shown.action}
                  </DialogTitle>
                  <p className="truncate text-sm text-ink-muted">{shown.label}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="flex items-center gap-2">
                <AdminConsolePill tone={severityTone(shown.severity)}>
                  {shown.severity}
                </AdminConsolePill>
                <AdminConsolePill>{shown.category}</AdminConsolePill>
              </div>

              <dl className="mt-4 flex flex-col">
                <DetailRow
                  label="Timestamp"
                  value={
                    <>
                      {absoluteTime(shown.timestamp)}{" "}
                      <span className="text-ink-faint">({relativeTime(shown.timestamp)})</span>
                    </>
                  }
                />
                <DetailRow label="Actor" value={shown.actor_email ?? "system"} />
                {shown.actor_id ? (
                  <DetailRow
                    label="Actor ID"
                    value={<span className="font-mono text-xs">{shown.actor_id}</span>}
                  />
                ) : null}
                <DetailRow
                  label="Resource"
                  value={
                    shown.resource_type || shown.resource_id ? (
                      <span className="font-mono text-xs">
                        {shown.resource_type ?? "—"}
                        {shown.resource_id ? `: ${shown.resource_id}` : ""}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <DetailRow
                  label="IP address"
                  value={<span className="font-mono text-xs">{shown.ip ?? "—"}</span>}
                />
                <DetailRow label="User agent" value={shown.user_agent || "—"} />
                <DetailRow
                  label="Event ID"
                  value={<span className="font-mono text-xs">{shown.id}</span>}
                />
              </dl>

              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Context
                  </p>
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
                  <pre className="max-h-64 overflow-auto rounded-lg border border-edge bg-surface p-3 text-[11px] leading-relaxed text-ink">
                    {context}
                  </pre>
                ) : (
                  <p className="rounded-lg border border-edge bg-surface p-3 text-xs text-ink-faint">
                    No additional context was recorded for this event.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
