// Human: Secondary notice box for Nebular OS storage endpoint copy on setup step 3.
// Agent: RENDERS read-only informational text; no API calls.

import type { ReactNode } from "react";

type SetupNoticeBoxProps = {
  children: ReactNode;
};

export function SetupNoticeBox({ children }: SetupNoticeBoxProps) {
  return (
    <div className="rounded-md border border-edge bg-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-muted">
      {children}
    </div>
  );
}
