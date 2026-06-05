// Human: Ownly AI Copilot sidebar — selected cell analysis card and ask prompt per Pencil We9gA.
// Agent: READS CopilotAnalysis; EMITS collapse/toggle and prompt submit callbacks.

import { ChevronRight, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import type { CopilotAnalysis } from "@/lib/spreadsheet/copilot";
import { cn } from "@/lib/utils";

type ExcelCopilotSidebarProps = {
  analysis: CopilotAnalysis | null;
  onCollapse: () => void;
};

export function ExcelCopilotSidebar({ analysis, onCollapse }: ExcelCopilotSidebarProps) {
  const [prompt, setPrompt] = useState("");

  return (
    <aside className="flex w-[280px] shrink-0 flex-col gap-4 border-l border-[#E5E7EB] bg-[#F7F8FA] p-4">
      {/* Human: Sidebar header — Ownly AI Copilot title + collapse chevron. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-[#2563EB]" aria-hidden />
            <p className="truncate text-sm font-bold text-[#1A1A1A]">Ownly AI Copilot</p>
          </div>
          <button
            type="button"
            aria-label="Collapse copilot sidebar"
            onClick={onCollapse}
            className="flex size-6 items-center justify-center rounded border border-[#E5E7EB] bg-white text-[#666666]"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
        <p className="text-[11px] text-[#888888]">Smart formulas, analysis &amp; auditing</p>
      </div>

      <div className="h-px bg-[#E5E7EB]" aria-hidden />

      {/* Human: Selected cell analysis card with badge, body copy, and action buttons. */}
      <section className="space-y-2">
        <p className="text-[10px] font-bold tracking-wide text-[#888888]">SELECTED CELL ANALYSIS</p>
        {analysis ? (
          <article className="space-y-2.5 rounded-lg border border-[#E5E7EB] bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xs font-bold text-[#1A1A1A]">{analysis.title}</h3>
              {analysis.badge ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    analysis.badgeTone === "over-budget" && "bg-[#FEE2E2] text-[#B91C1C]",
                    analysis.badgeTone === "under-budget" && "bg-[#DBEAFE] text-[#1D4ED8]",
                    analysis.badgeTone === "neutral" && "bg-[#D1FAE5] text-[#047857]",
                  )}
                >
                  {analysis.badge}
                </span>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-[#666666]">{analysis.body}</p>
            <div className="space-y-1.5">
              <button
                type="button"
                className="w-full rounded-lg border border-[#2563EB] px-3 py-2 text-left text-xs font-semibold text-[#2563EB] hover:bg-[#EFF6FF]"
              >
                {analysis.primaryAction}
              </button>
              <button type="button" className="w-full px-1 py-1 text-left text-xs font-medium text-[#2563EB] hover:underline">
                {analysis.secondaryAction}
              </button>
            </div>
          </article>
        ) : (
          <p className="text-xs text-[#666666]">Select a cell to see Copilot analysis.</p>
        )}
      </section>

      <div className="h-px bg-[#E5E7EB]" aria-hidden />

      {/* Human: Ask Copilot prompt row with send icon per Pencil tcHCZ. */}
      <section className="mt-auto space-y-2">
        <p className="text-[10px] font-bold tracking-wide text-[#888888]">ASK COPILOT</p>
        <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2">
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask to write a formula or analyze..."
            className="min-w-0 flex-1 bg-transparent text-xs text-[#1A1A1A] outline-none placeholder:text-[#888888]"
          />
          <button type="button" aria-label="Send prompt" className="text-[#2563EB]">
            <Send className="size-3.5" aria-hidden />
          </button>
        </div>
      </section>
    </aside>
  );
}
