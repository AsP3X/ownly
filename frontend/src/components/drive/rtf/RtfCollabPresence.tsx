// Human: Live co-editing presence strip — collaborators, locks (RTF), transport.
// Agent: READS CollabParticipant[]; USED by RtfEditorDialog + TextCodeEditorDialog.

import type { CollabParticipant } from "@/api/client";

type RtfCollabPresenceProps = {
  participants: CollabParticipant[];
  currentUserId?: string | null;
  error?: string | null;
  transport?: "ws" | "poll";
  /** Human: Optional right-side hint; null hides it. Default is RTF lock copy. */
  statusHint?: string | null;
};

export function RtfCollabPresence({
  participants,
  currentUserId,
  error,
  transport,
  statusHint = "Active sentences are protected",
}: RtfCollabPresenceProps) {
  if (error) {
    const offline =
      /unavailable|offline|network|failed to fetch|websocket/i.test(error);
    return (
      <div className="flex h-8 shrink-0 items-center border-b border-[#FDE68A] bg-[#FFFBEB] px-3 text-[11px] text-[#92400E]">
        {offline ? `Co-editing offline — ${error}` : error}
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
          const hasCaret =
            person.selection_start != null || person.selection_end != null;
          return (
            <div
              key={person.user_id}
              className="flex shrink-0 items-center gap-1 rounded-full border border-[#E5E7EB] bg-white pr-2"
              title={[
                person.display_name,
                locked
                  ? `Locked chars ${person.lock_start}–${person.lock_end}`
                  : null,
                hasCaret ? `Caret at ${person.selection_start}` : null,
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
                {locked ? " · locked" : hasCaret ? " · active" : ""}
              </span>
            </div>
          );
        })}
      </div>
      {statusHint ? (
        <span className="hidden text-[10px] text-[#94A3B8] sm:inline">{statusHint}</span>
      ) : null}
    </div>
  );
}
