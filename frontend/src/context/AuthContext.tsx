// Human: Session state for JWT + user profile persisted in localStorage across reloads.
// Agent: WRITES mediavault_token + mediavault_user; PROVIDES AuthContext to the app shell.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCurrentUser, setUnauthorizedHandler } from "@/api/client";
import { AuthContext, type User } from "@/context/auth-context";
import { prefetchDrivePageChunk } from "@/lib/prefetch-route-chunks";

/** Human: Run session probes after first paint so login shell is not blocked on /me. */
function scheduleIdleTask(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(() => task());
    return () => cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 1);
  return () => window.clearTimeout(id);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("mediavault_token"));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("mediavault_user");
    return raw ? (JSON.parse(raw) as User) : null;
  });

  // Human: Persist a successful login or setup response so protected routes work after refresh.
  // Agent: WRITES localStorage; MUTATES token + user React state.
  const setAuth = useCallback((nextToken: string, nextUser: User) => {
    localStorage.setItem("mediavault_token", nextToken);
    localStorage.setItem("mediavault_user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  // Human: Clear client session when setup guard detects stale tokens or the user signs out.
  // Agent: REMOVES localStorage keys; RESETS token + user; NAVIGATES / (public landing) replace.
  const logout = useCallback(() => {
    localStorage.removeItem("mediavault_token");
    localStorage.removeItem("mediavault_user");
    setToken(null);
    setUser(null);
    navigate("/", { replace: true });
  }, [navigate]);

  // Human: Any API 401 while a token exists should clear local session (revoked JWT, disabled user, etc.).
  // Agent: REGISTERS logout with apiFetch; RUNS on all pages that mount AuthProvider.
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Human: Warm the drive chunk while the user is already signed in on repeat visits.
  // Agent: CALLS prefetchDrivePageChunk when token is present at provider mount.
  useEffect(() => {
    if (!token) return;
    prefetchDrivePageChunk();
  }, [token]);

  // Human: Poll /me so revoked sessions log out even on idle pages without another API call.
  // Agent: GET /me on idle + interval + focus; 401 CALLS unauthorizedHandler.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const probe = async () => {
      try {
        const profile = await fetchCurrentUser();
        if (cancelled) return;
        setUser((prev) =>
          prev &&
          prev.id === profile.id &&
          prev.email === profile.email &&
          prev.role === profile.role &&
          prev.enabled === profile.enabled
            ? prev
            : {
                id: profile.id,
                email: profile.email,
                role: profile.role,
                enabled: profile.enabled,
              },
        );
      } catch {
        // Human: apiFetch already invoked logout on 401.
      }
    };

    const cancelIdle = scheduleIdleTask(() => {
      if (!cancelled) void probe();
    });
    const intervalId = window.setInterval(() => void probe(), 20_000);
    const onFocus = () => void probe();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      cancelIdle();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [token]);

  const value = useMemo(
    () => ({ token, user, setAuth, logout }),
    [token, user, setAuth, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
