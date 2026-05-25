// Human: Paperclip badge shown on files/folders that have an active share link.
// Agent: READS public/users flags; RENDERS lucide Paperclip with accessible label.

import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShareFlags } from "@/api/client";

type SharedIndicatorProps = {
  flags?: ShareFlags | null;
  className?: string;
};

// Human: True when the item has any active share (public link or user grant).
// Agent: OR of ShareFlags.public and ShareFlags.users.
export function isShared(flags?: ShareFlags | null): boolean {
  return Boolean(flags?.public || flags?.users);
}

function shareLabel(flags: ShareFlags): string {
  if (flags.public && flags.users) return "Shared publicly and with users";
  if (flags.public) return "Shared with public link";
  if (flags.users) return "Shared with users";
  return "Shared";
}

export function SharedIndicator({ flags, className }: SharedIndicatorProps) {
  if (!isShared(flags)) return null;

  const label = shareLabel(flags!);

  return (
    <span title={label} className={cn("inline-flex shrink-0", className)}>
      <Paperclip className="size-3.5 text-sky-600" aria-label={label} />
    </span>
  );
}
