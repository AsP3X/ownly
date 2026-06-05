// Human: Ownly AI Copilot sidebar — selected cell analysis card and ask prompt per Pencil We9gA.
// Agent: READS CopilotAnalysis; EMITS collapse/toggle and prompt submit callbacks.

import { ChevronRight, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import type { CopilotAnalysis } from "@/lib/spreadsheet/copilot";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import { cn } from "@/lib/utils";

type ExcelCopilotSidebarProps = {
  analysis: CopilotAnalysis | null;
  onCollapse: () => void;
};

export function ExcelCopilotSidebar({ analysis, onCollapse }: ExcelCopilotSidebarProps) {
  const [prompt, setPrompt] = useState("");

  return (
    <aside
      className="flex shrink-0 flex-col border-l border-[#E5E7EB] bg-[#F7F8FA]"
      style={{ width: scaledPx(280), gap: scaledPx(16), padding: scaledPx(16) }}
    >
      {/* Human: Sidebar header — Ownly AI Copilot title + collapse chevron. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="shrink-0 text-[#2563EB]" style={{ width: scaledPx(16), height: scaledPx(16) }} aria-hidden />
            <p className="truncate font-bold text-[#1A1A1A]" style={{ fontSize: scaledPx(14) }}>
              Ownly AI Copilot
            </p>
          </div>
          <button
            type="button"
            aria-label="Collapse copilot sidebar"
            onClick={onCollapse}
            className="flex items-center justify-center rounded border border-[#E5E7EB] bg-white text-[#666666]"
            style={{ width: scaledPx(24), height: scaledPx(24) }}
          >
            <ChevronRight style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
          </button>
        </div>
        <p className="text-[#888888]" style={{ fontSize: scaledPx(11) }}>Smart formulas, analysis &amp; auditing</p>
      </div>

      <div className="h-px bg-[#E5E7EB]" aria-hidden />

      {/* Human: Selected cell analysis card with badge, body copy, and action buttons. */}
      <section className="space-y-2">
        <p className="font-bold tracking-wide text-[#888888]" style={{ fontSize: scaledPx(10) }}>
          SELECTED CELL ANALYSIS
        </p>
        {analysis ? (
          <article
            className="rounded-lg border border-[#E5E7EB] bg-white"
            style={{ padding: scaledPx(12), gap: scaledPx(10), display: "grid" }}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-[#1A1A1A]" style={{ fontSize: scaledPx(12) }}>
                {analysis.title}
              </h3>
              {analysis.badge ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full font-semibold",
                    analysis.badgeTone === "over-budget" && "bg-[#FEE2E2] text-[#B91C1C]",
                    analysis.badgeTone === "under-budget" && "bg-[#DBEAFE] text-[#1D4ED8]",
                    analysis.badgeTone === "neutral" && "bg-[#D1FAE5] text-[#047857]",
                  )}
                  style={{ fontSize: scaledPx(10), padding: `${scaledPx(2)}px ${scaledPx(8)}px` }}
                >
                  {analysis.badge}
                </span>
              ) : null}
            </div>
            <p className="leading-relaxed text-[#666666]" style={{ fontSize: scaledPx(12) }}>
              {analysis.body}
            </p>
            <div style={{ display: "grid", gap: scaledPx(6) }}>
              <button
                type="button"
                className="w-full rounded-lg border border-[#2563EB] text-left font-semibold text-[#2563EB] hover:bg-[#EFF6FF]"
                style={{ padding: `${scaledPx(8)}px ${scaledPx(12)}px`, fontSize: scaledPx(12) }}
              >
                {analysis.primaryAction}
              </button>
              <button
                type="button"
                className="w-full text-left font-medium text-[#2563EB] hover:underline"
                style={{ padding: `${scaledPx(4)}px`, fontSize: scaledPx(12) }}
              >
                {analysis.secondaryAction}
              </button>
            </div>
          </article>
        ) : (
          <p className="text-[#666666]" style={{ fontSize: scaledPx(12) }}>Select a cell to see Copilot analysis.</p>
        )}
      </section>

      <div className="h-px bg-[#E5E7EB]" aria-hidden />

      {/* Human: Ask Copilot prompt row with send icon per Pencil tcHCZ. */}
      <section className="mt-auto space-y-2">
        <p className="font-bold tracking-wide text-[#888888]" style={{ fontSize: scaledPx(10) }}>
          ASK COPILOT
        </p>
        <div
          className="flex items-center rounded-lg border border-[#E5E7EB] bg-white"
          style={{ gap: scaledPx(8), padding: `${scaledPx(8)}px ${scaledPx(12)}px` }}
        >
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask to write a formula or analyze..."
            className="min-w-0 flex-1 bg-transparent text-[#1A1A1A] outline-none placeholder:text-[#888888]"
            style={{ fontSize: scaledPx(12) }}
          />
          <button type="button" aria-label="Send prompt" className="text-[#2563EB]">
            <Send style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
          </button>
        </div>
      </section>
    </aside>
  );
}
