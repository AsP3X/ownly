// Human: React context object holding JWT session state — consumed by useAuth hook and AuthProvider.
// Agent: EXPORTS AuthContext + User type; NO components in this file (fast refresh safe).

import { createContext } from "react";

export type User = {
  id: string;
  email: string;
  role: string;
  enabled: boolean;
};

export type AuthContextValue = {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
