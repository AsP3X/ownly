// Human: Session state restored from HttpOnly cookies — user profile kept in React memory only.
// Agent: PROBES /me on mount; PROVIDES AuthContext to the app shell.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchCurrentUser,
  fetchMyInstancePermissions,
  postLogoutBestEffort,
  DEFAULT_SESSION_TTL_SECS,
  SESSION_REFRESH_CHECK_INTERVAL_MS,
  setSessionRefreshListener,
  setUnauthorizedHandler,
  shouldProactivelyRefreshToken,
  tryRefreshAuthToken,
} from "@/api/client";
import { clearCsrfHint, readCsrfHint, syncCsrfHintFromCookie } from "@/lib/csrf-hint";
import { readCsrfTokenFromCookie } from "@/api/core";
import { AuthContext, SESSION_ACTIVE, type User } from "@/context/auth-context";
import { hasInstancePermission as checkInstancePermission, isInstanceAdmin } from "@/lib/instance-permissions";
import { prefetchDrivePageChunk } from "@/lib/prefetch-route-chunks";
import { clearSessionHint, setSessionHint } from "@/lib/session-hint";

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
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [instancePermissions, setInstancePermissions] = useState<string[]>([]);
  const sessionExpHintRef = useRef<number | null>(null);
  const logoutInProgressRef = useRef(false);

  // Human: Restore cookie session after reload or a new tab without reading JWT from web storage.
  // Agent: ALWAYS GET /me + /me/permissions (HttpOnly cookie may exist without a client hint); CLEARS on 401.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const profile = await fetchCurrentUser();
        if (cancelled) return;
        const permPayload = await fetchMyInstancePermissions();
        if (cancelled) return;
        setUser({
          id: profile.id,
          email: profile.email,
          role: profile.role,
          enabled: profile.enabled,
        });
        setInstancePermissions(permPayload.permissions);
        setToken(SESSION_ACTIVE);
        setSessionHint();
        syncCsrfHintFromCookie(readCsrfTokenFromCookie);
        if (!readCsrfTokenFromCookie() && !readCsrfHint()) {
          void tryRefreshAuthToken();
        }
      } catch {
        if (!cancelled) {
          clearSessionHint();
          clearCsrfHint();
          setUser(null);
          setToken(null);
          setInstancePermissions([]);
        }
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Human: Persist a successful login or setup response in React state only.
  // Agent: MUTATES token + user React state; OPTIONAL exp hint schedules proactive refresh.
  const setAuth = useCallback((nextUser: User, sessionExpHint?: number | null) => {
    sessionExpHintRef.current = sessionExpHint ?? null;
    setSessionHint();
    setToken(SESSION_ACTIVE);
    setUser(nextUser);
    setSessionReady(true);
  }, []);

  // Human: Clear client session when setup guard detects stale tokens or the user signs out.
  // Agent: POST /auth/logout; RESETS token + user; NAVIGATES / (public landing) replace.
  const logout = useCallback(() => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;
    void postLogoutBestEffort().finally(() => {
      logoutInProgressRef.current = false;
    });
    clearSessionHint();
    clearCsrfHint();
    sessionExpHintRef.current = null;
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

  // Human: Keep session marker aligned when apiFetch silently rotates the HttpOnly cookie after refresh.
  // Agent: LISTENS setSessionRefreshListener; UPDATES exp hint from server expires_in_seconds.
  useEffect(() => {
    setSessionRefreshListener((expiresInSeconds) => {
      setSessionHint();
      setToken(SESSION_ACTIVE);
      const ttl =
        typeof expiresInSeconds === "number" && expiresInSeconds > 0
          ? expiresInSeconds
          : DEFAULT_SESSION_TTL_SECS;
      sessionExpHintRef.current = Math.floor(Date.now() / 1000) + ttl;
    });
    return () => setSessionRefreshListener(null);
  }, []);

  // Human: Keep access cookies alive — browsers throttle multi-hour setTimeouts, so poll + focus refresh.
  // Agent: INTERVAL every 10m; visibility/focus CALL tryRefreshAuthToken when near exp or hint missing.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const maybeRefresh = () => {
      if (cancelled) return;
      const expHint = sessionExpHintRef.current;
      if (!expHint || shouldProactivelyRefreshToken(expHint)) {
        void tryRefreshAuthToken();
      }
    };

    // Human: Seed a conservative exp if login never provided one (cookie-only restore).
    if (!sessionExpHintRef.current) {
      sessionExpHintRef.current = Math.floor(Date.now() / 1000) + DEFAULT_SESSION_TTL_SECS;
    }

    maybeRefresh();
    const intervalId = window.setInterval(maybeRefresh, SESSION_REFRESH_CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    const onFocus = () => maybeRefresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
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
      sessionReady,
      instancePermissions,
      setAuth,
      logout,
      hasInstancePermission,
      isAdmin,
    }),
    [token, user, sessionReady, instancePermissions, setAuth, logout, hasInstancePermission, isAdmin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
