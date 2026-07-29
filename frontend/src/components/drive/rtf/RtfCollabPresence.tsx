// Human: Live co-editing presence strip for the RTF editor — collaborators, locks, transport.
// Agent: READS DocumentCollabParticipant[]; RENDERS under RTF toolbar when session is active.

import type { DocumentCollabParticipant } from "@/api/client";

type RtfCollabPresenceProps = {
  participants: DocumentCollabParticipant[];
  currentUserId?: string | null;
  error?: string | null;
  transport?: "ws" | "poll";
};

export function RtfCollabPresence({
  participants,
  currentUserId,
  error,
  transport,
}: RtfCollabPresenceProps) {
  if (error) {
    return (
      <div className="flex h-8 shrink-0 items-center border-b border-[#FDE68A] bg-[#FFFBEB] px-3 text-[11px] text-[#92400E]">
        Co-editing offline — {error}
      </div>
    );
  }

  if (participants.length === 0) return null;

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 border-b border-[#E5E7EB] bg-[#F8FAFC] px-3"
      aria-label="Collaborators"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
        Live{transport === "ws" ? " · WS" : " · poll"}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {participants.map((person) => {
          const isYou = currentUserId && person.user_id === currentUserId;
          const initial = (person.display_name || "?").trim().charAt(0).toUpperCase();
          const locked =
            person.lock_start != null &&
            person.lock_end != null &&
            person.lock_end > person.lock_start;
          return (
            <div
              key={person.user_id}
              className="flex shrink-0 items-center gap-1 rounded-full border border-[#E5E7EB] bg-white pr-2"
              title={[
                person.display_name,
                locked
                  ? `Editing sentence ${person.lock_start}–${person.lock_end}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: person.color }}
              >
                {initial}
              </span>
              <span className="max-w-[9rem] truncate text-[10px] text-[#334155]">
                {isYou ? "You" : person.display_name}
                {locked ? " · locked" : ""}
              </span>
            </div>
          );
        })}
      </div>
      <span className="hidden text-[10px] text-[#94A3B8] sm:inline">
        Active sentences are protected
      </span>
    </div>
  );
}
