// Human: Track whether the browser still has a network connection.
// Agent: READS navigator.onLine and the online/offline events; no polling, no requests.

import { useEffect, useState } from "react";

/**
 * Human: `false` is trustworthy — the browser knows the interface is down. `true` only means a
 * route exists, not that the Ownly server is reachable, so keep surfacing request errors too.
 * Agent: SSR/jsdom without navigator defaults to online so nothing renders an offline banner.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Human: Resync once on mount — the connection can drop before the listeners attach.
    setOnline(navigator.onLine !== false);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
