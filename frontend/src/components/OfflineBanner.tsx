// Human: Standing notice while the browser has no connection, on every route.
// Agent: READS useOnlineStatus; RENDERS nothing when online; announced politely, never focus-stealing.

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    // Human: Pinned under the top edge and above dialogs so it stays visible while one is open.
    // Agent: pointer-events-none on the wrapper — the banner must never block the UI beneath it.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]"
    >
      <p className="flex items-center gap-2 rounded-full border border-warn/40 bg-panel/95 px-3.5 py-1.5 text-[13px] font-medium text-ink shadow-lg">
        <WifiOff className="size-4 shrink-0 text-warn" aria-hidden />
        You are offline — changes cannot be saved until the connection returns.
      </p>
    </div>
  );
}
