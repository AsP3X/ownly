// Human: Warm likely route chunks during idle time so navigation feels instant after login.
// Agent: CALLS dynamic import() for DrivePage; NO-OP when token absent; USES requestIdleCallback when available.

/** Human: Prefetch the drive shell chunk when a JWT is already in localStorage. */
export function prefetchDrivePageChunk(): void {
  const schedule =
    typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : (callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);

  schedule(() => {
    void import("@/pages/DrivePage");
  });
}
