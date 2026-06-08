// Human: In-app Excel help search for Ownly spreadsheet features.
// Agent: RENDERS inside Help ribbon tab; FILTERS static help topics client-side.

import { useMemo, useState } from "react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import { EXCEL_RIBBON_FONT } from "@/components/drive/excel/excel-ribbon-tokens";
import { RibbonGroup } from "@/components/drive/excel/excel-ribbon-primitives";

const HELP_TOPICS = [
  { title: "Formulas", body: "Use the formula bar or Insert Function. Cross-sheet refs: Sheet2!A1. Dynamic arrays: FILTER, SORT, UNIQUE." },
  { title: "Save", body: "Save & Close uploads an updated .xlsx to Ownly. Save Copy downloads locally." },
  { title: "Merge cells", body: "Select a range → Insert → Merge Cells. Merges round-trip on save." },
  { title: "Print", body: "Page Layout → Print Preview. Export PDF from the File tab." },
  { title: "Copilot", body: "Ask Copilot in the sidebar for formula hints and cell analysis." },
  { title: "Protection", body: "Review → Protect Sheet locks edits until unprotected." },
];

export function ExcelHelpPanel() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return HELP_TOPICS;
    return HELP_TOPICS.filter(
      (topic) =>
        topic.title.toLowerCase().includes(normalized) || topic.body.toLowerCase().includes(normalized),
    );
  }, [query]);

  return (
    <RibbonGroup label="Tell me what you want to do">
      <div className="flex flex-col gap-2" style={{ minWidth: scaledPx(360), padding: scaledPx(8) }}>
        <input
          type="search"
          placeholder="Search help"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
          style={{ fontFamily: EXCEL_RIBBON_FONT, fontSize: scaledPx(11) }}
        />
        <ul className="max-h-40 overflow-y-auto" style={{ fontFamily: EXCEL_RIBBON_FONT, fontSize: scaledPx(11) }}>
          {results.map((topic) => (
            <li key={topic.title} className="mb-2 text-[#444444]">
              <span className="font-semibold text-[#1A1A1A]">{topic.title}: </span>
              {topic.body}
            </li>
          ))}
        </ul>
      </div>
    </RibbonGroup>
  );
}
