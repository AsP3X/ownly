// Human: Compact co-editing presence strip — avatars of active participants + cursor cells.
// Agent: READS SpreadsheetCollabParticipant[]; RENDERS under ribbon when session active.

import type { SpreadsheetCollabParticipant } from "@/api/client";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";

type ExcelCollabPresenceProps = {
  participants: SpreadsheetCollabParticipant[];
  currentUserId?: string | null;
  error?: string | null;
  transport?: "ws" | "poll";
};

export function ExcelCollabPresence({
  participants,
  currentUserId,
  error,
  transport,
}: ExcelCollabPresenceProps) {
  if (error) {
    return (
      <div
        className="flex shrink-0 items-center border-b border-[#FDE68A] bg-[#FFFBEB] px-3 text-[#92400E]"
        style={{ height: scaledPx(28), fontSize: scaledPx(11) }}
      >
        Co-editing offline — {error}
      </div>
    );
  }

  if (participants.length === 0) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-[#E5E7EB] bg-[#F8FAFC] px-3"
      style={{ height: scaledPx(28) }}
      aria-label="Collaborators"
    >
      <span className="font-semibold text-[#64748B]" style={{ fontSize: scaledPx(10) }}>
        Live{transport === "ws" ? " · WS" : transport === "poll" ? " · poll" : ""}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {participants.map((person) => {
          const isYou = currentUserId && person.user_id === currentUserId;
          const initial = (person.display_name || "?").trim().charAt(0).toUpperCase();
          return (
            <div
              key={person.user_id}
              className="flex shrink-0 items-center gap-1 rounded-full border border-[#E5E7EB] bg-white pr-2"
              title={[
                person.display_name,
                person.sheet_name ? `Sheet: ${person.sheet_name}` : null,
                person.active_cell ? `Cell: ${person.active_cell}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <span
                className="flex items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{
                  width: scaledPx(20),
                  height: scaledPx(20),
                  backgroundColor: person.color,
                  fontSize: scaledPx(10),
                }}
              >
                {initial}
              </span>
              <span className="max-w-[8rem] truncate text-[#334155]" style={{ fontSize: scaledPx(10) }}>
                {isYou ? "You" : person.display_name}
                {person.active_cell ? ` · ${person.active_cell}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
