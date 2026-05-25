// Human: Read the current JWT session from AuthProvider anywhere in the React tree.
// Agent: READS AuthContext; THROWS if provider missing; RETURNS token, user, setAuth, logout.

import { useContext } from "react";
import { AuthContext } from "@/context/auth-context";

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
