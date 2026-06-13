// Human: Session state for JWT + user profile persisted in localStorage across reloads.
// Agent: WRITES ownly_token + ownly_user; PROVIDES AuthContext to the app shell.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCurrentUser, fetchMyInstancePermissions, setTokenRefreshListener, setUnauthorizedHandler, shouldProactivelyRefreshToken, tryRefreshAuthToken } from "@/api/client";
import { AuthContext, type User } from "@/context/auth-context";
import { hasInstancePermission as checkInstancePermission, isInstanceAdmin } from "@/lib/instance-permissions";
import { getJwtExp } from "@/lib/jwt";
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
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("ownly_token"));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("ownly_user");
    return raw ? (JSON.parse(raw) as User) : null;
  });
  const [instancePermissions, setInstancePermissions] = useState<string[]>([]);

  // Human: Persist a successful login or setup response so protected routes work after refresh.
  // Agent: WRITES localStorage; MUTATES token + user React state.
  const setAuth = useCallback((nextToken: string, nextUser: User) => {
    localStorage.setItem("ownly_token", nextToken);
    localStorage.setItem("ownly_user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  // Human: Clear client session when setup guard detects stale tokens or the user signs out.
  // Agent: REMOVES localStorage keys; RESETS token + user; NAVIGATES / (public landing) replace.
  const logout = useCallback(() => {
    localStorage.removeItem("ownly_token");
    localStorage.removeItem("ownly_user");
    setToken(null);
    setUser(null);
    setInstancePermissions([]);
    navigate("/", { replace: true });
  }, [navigate]);

  // Human: Any API 401 while a token exists should clear local session (revoked JWT, disabled user, etc.).
  // Agent: REGISTERS logout with apiFetch; RUNS on all pages that mount AuthProvider.
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Human: Keep React token state aligned when apiFetch silently rotates the JWT after refresh.
  // Agent: LISTENS setTokenRefreshListener; UPDATES token state without clearing user profile.
  useEffect(() => {
    setTokenRefreshListener((nextToken) => setToken(nextToken));
    return () => setTokenRefreshListener(null);
  }, []);

  // Human: Proactively refresh the access JWT before the 24h exp so idle tabs stay signed in.
  // Agent: SCHEDULES tryRefreshAuthToken from JWT exp; RE-SCHEDULES after each successful rotation.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let timeoutId = 0;

    const scheduleRefresh = () => {
      const exp = getJwtExp(token);
      if (!exp) return;

      if (shouldProactivelyRefreshToken(token)) {
        void tryRefreshAuthToken();
        return;
      }

      const refreshAtMs = (exp - 2 * 3600) * 1000;
      const delayMs = Math.max(refreshAtMs - Date.now(), 60_000);
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        void tryRefreshAuthToken();
      }, delayMs);
    };

    scheduleRefresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [token]);

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
        const [profile, permPayload] = await Promise.all([
          fetchCurrentUser(),
          fetchMyInstancePermissions(),
        ]);
        if (cancelled) return;
        setInstancePermissions(permPayload.permissions);
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

  const hasInstancePermission = useCallback(
    (permission: string) => checkInstancePermission(instancePermissions, permission),
    [instancePermissions],
  );

  const isAdmin = useMemo(
    () => isInstanceAdmin(instancePermissions, user?.role),
    [instancePermissions, user?.role],
  );

  const value = useMemo(
    () => ({
      token,
      user,
      instancePermissions,
      setAuth,
      logout,
      hasInstancePermission,
      isAdmin,
    }),
    [token, user, instancePermissions, setAuth, logout, hasInstancePermission, isAdmin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
