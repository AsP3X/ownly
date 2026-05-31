// Human: Full-screen placeholder while a lazy route chunk loads.
// Agent: RENDERS centered spinner; USED by App Suspense boundaries around React.lazy routes.

import { Loader2 } from "lucide-react";

export function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>Loading…</span>
    </div>
  );
}
