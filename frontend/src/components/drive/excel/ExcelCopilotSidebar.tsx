// Human: Ownly AI Copilot sidebar — expands for analysis or collapses to a right-edge ledge rail.
// Agent: READS CopilotAnalysis + collapsed flag; EMITS onCollapsedChange; REPLACES header toggle button.

import { ChevronLeft, ChevronRight, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  EXCEL_COPILOT_LEDGE_WIDTH_BASE,
  EXCEL_COPILOT_SIDEBAR_WIDTH_BASE,
  scaledPx,
} from "@/components/drive/excel/excel-dialog-scale";
import { postSpreadsheetCopilot } from "@/api/client";
import { cellAddressLabel } from "@/lib/spreadsheet/cells";
import { buildCopilotPromptReply, type CopilotAnalysis } from "@/lib/spreadsheet/copilot";
import { cn } from "@/lib/utils";

import type { CellAddress } from "@/lib/spreadsheet/types";

type ExcelCopilotSidebarProps = {
  analysis: CopilotAnalysis | null;
  activeAddress?: CellAddress | null;
  fileId?: string;
  sheetName?: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNavigateToCell?: (address: CellAddress) => void;
};

// Human: Narrow vertical rail — sparkles + chevron; click anywhere to expand Copilot.
// Agent: RENDERS when collapsed=true; FULL-HEIGHT button replaces header "Copilot Sidebar" toggle.
function CopilotLedge({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      type="button"
      aria-label="Expand Ownly AI Copilot"
      onClick={onExpand}
      className="group flex h-full w-full flex-col items-center border-0 bg-surface py-4 text-brand transition-colors hover:bg-brand-weak"
      style={{ gap: scaledPx(12), paddingInline: scaledPx(4) }}
    >
      <Sparkles
        className="shrink-0 text-brand group-hover:scale-105"
        style={{ width: scaledPx(16), height: scaledPx(16) }}
        aria-hidden
      />
      <ChevronLeft
        className="shrink-0 text-ink-muted group-hover:text-brand"
        style={{ width: scaledPx(14), height: scaledPx(14) }}
        aria-hidden
      />
      <span
        className="font-semibold tracking-wide text-ink-faint group-hover:text-brand [writing-mode:vertical-rl] rotate-180"
        style={{ fontSize: scaledPx(9), letterSpacing: "0.08em" }}
      >
        COPILOT
      </span>
    </button>
  );
}

export function ExcelCopilotSidebar({
  analysis,
  activeAddress = null,
  fileId,
  sheetName,
  collapsed,
  onCollapsedChange,
  onNavigateToCell,
}: ExcelCopilotSidebarProps) {
  const [prompt, setPrompt] = useState("");
  const [promptReply, setPromptReply] = useState("");
  const [sending, setSending] = useState(false);
  const expandedWidth = scaledPx(EXCEL_COPILOT_SIDEBAR_WIDTH_BASE);
  const ledgeWidth = scaledPx(EXCEL_COPILOT_LEDGE_WIDTH_BASE);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-l border-edge bg-surface transition-[width] duration-200 ease-out",
        collapsed ? "p-0" : "",
      )}
      style={{
        width: collapsed ? ledgeWidth : expandedWidth,
        gap: collapsed ? 0 : scaledPx(16),
        padding: collapsed ? 0 : scaledPx(16),
      }}
    >
      {collapsed ? (
        <CopilotLedge onExpand={() => onCollapsedChange(false)} />
      ) : (
        <>
          {/* Human: Sidebar header — Ownly AI Copilot title + collapse chevron onto ledge. */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles
                  className="shrink-0 text-brand"
                  style={{ width: scaledPx(16), height: scaledPx(16) }}
                  aria-hidden
                />
                <p className="truncate font-bold text-ink" style={{ fontSize: scaledPx(14) }}>
                  Ownly AI Copilot
                </p>
              </div>
              <button
                type="button"
                aria-label="Collapse copilot sidebar"
                onClick={() => onCollapsedChange(true)}
                className="flex items-center justify-center rounded border border-edge bg-panel text-ink-muted hover:border-[#BFDBFE] hover:bg-brand-weak hover:text-brand"
                style={{ width: scaledPx(24), height: scaledPx(24) }}
              >
                <ChevronRight style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
              </button>
            </div>
            <p className="text-ink-faint" style={{ fontSize: scaledPx(11) }}>
              Smart formulas, analysis &amp; auditing
            </p>
          </div>

          <div className="h-px bg-edge" aria-hidden />

          {/* Human: Selected cell analysis card with badge, body copy, and action buttons. */}
          <section className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            <p className="font-bold tracking-wide text-ink-faint" style={{ fontSize: scaledPx(10) }}>
              SELECTED CELL ANALYSIS
            </p>
            {analysis ? (
              <article
                className="rounded-lg border border-edge bg-panel"
                style={{ padding: scaledPx(12), gap: scaledPx(10), display: "grid" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-ink" style={{ fontSize: scaledPx(12) }}>
                    {analysis.title}
                  </h3>
                  {analysis.badge ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full font-semibold",
                        analysis.badgeTone === "over-budget" && "bg-[#FEE2E2] text-[#B91C1C]",
                        analysis.badgeTone === "under-budget" && "bg-brand-weak text-brand-hover",
                        analysis.badgeTone === "neutral" && "bg-[#D1FAE5] text-[#047857]",
                      )}
                      style={{ fontSize: scaledPx(10), padding: `${scaledPx(2)}px ${scaledPx(8)}px` }}
                    >
                      {analysis.badge}
                    </span>
                  ) : null}
                </div>
                <p className="leading-relaxed text-ink-muted" style={{ fontSize: scaledPx(12) }}>
                  {analysis.body}
                </p>
                <div style={{ display: "grid", gap: scaledPx(6) }}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-brand text-left font-semibold text-brand hover:bg-brand-weak"
                    style={{ padding: `${scaledPx(8)}px ${scaledPx(12)}px`, fontSize: scaledPx(12) }}
                    onClick={() => onNavigateToCell?.({ row: 3, col: 6 })}
                  >
                    {analysis.primaryAction}
                  </button>
                  <button
                    type="button"
                    className="w-full text-left font-medium text-brand hover:underline"
                    style={{ padding: `${scaledPx(4)}px`, fontSize: scaledPx(12) }}
                    onClick={() => onNavigateToCell?.({ row: 1, col: 6 })}
                  >
                    {analysis.secondaryAction}
                  </button>
                </div>
              </article>
            ) : (
              <p className="text-ink-muted" style={{ fontSize: scaledPx(12) }}>
                Select a cell to see Copilot analysis.
              </p>
            )}
          </section>

          <div className="h-px bg-edge" aria-hidden />

          {/* Human: Ask Copilot prompt row with send icon per Pencil tcHCZ. */}
          <section className="shrink-0 space-y-2">
            <p className="font-bold tracking-wide text-ink-faint" style={{ fontSize: scaledPx(10) }}>
              ASK COPILOT
            </p>
            <div
              className="flex items-center rounded-lg border border-edge bg-panel"
              style={{ gap: scaledPx(8), padding: `${scaledPx(8)}px ${scaledPx(12)}px` }}
            >
              <input
                type="text"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask to write a formula or analyze..."
                className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
                style={{ fontSize: scaledPx(12) }}
              />
              <button
                type="button"
                aria-label="Send prompt"
                className="text-brand"
                disabled={sending}
                onClick={() => {
                  const trimmed = prompt.trim();
                  if (!trimmed || sending) return;
                  setSending(true);
                  const localFallback = buildCopilotPromptReply(trimmed, activeAddress);
                  void postSpreadsheetCopilot({
                    prompt: trimmed,
                    cell: activeAddress ? cellAddressLabel(activeAddress) : undefined,
                    sheet_name: sheetName,
                    file_id: fileId,
                  })
                    .then((response) => {
                      setPromptReply(response.reply);
                      setPrompt("");
                    })
                    .catch(() => {
                      setPromptReply(localFallback);
                      setPrompt("");
                    })
                    .finally(() => setSending(false));
                }}
              >
                <Send style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
              </button>
            </div>
            {promptReply ? (
              <p className="text-ink-muted" style={{ fontSize: scaledPx(11) }}>
                {promptReply}
              </p>
            ) : null}
          </section>
        </>
      )}
    </aside>
  );
}
