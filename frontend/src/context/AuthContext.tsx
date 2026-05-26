// Human: Session state for JWT + user profile persisted in localStorage across reloads.
// Agent: WRITES mediavault_token + mediavault_user; PROVIDES AuthContext to the app shell.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext, type User } from "@/context/auth-context";

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
  // Agent: REMOVES localStorage keys; RESETS token + user; NAVIGATES /login replace.
  const logout = useCallback(() => {
    localStorage.removeItem("mediavault_token");
    localStorage.removeItem("mediavault_user");
    setToken(null);
    setUser(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({ token, user, setAuth, logout }),
    [token, user, setAuth, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
