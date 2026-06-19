// Human: React context object holding cookie-backed session state — consumed by useAuth hook and AuthProvider.
// Agent: EXPORTS AuthContext + User type; NO components in this file (fast refresh safe).

import { createContext } from "react";

export type User = {
  id: string;
  email: string;
  role: string;
  enabled: boolean;
};

/** Human: Truthy marker for route guards — never holds the raw JWT (SEC-024). */
export const SESSION_ACTIVE = "cookie";

export type AuthContextValue = {
  token: string | null;
  user: User | null;
  sessionReady: boolean;
  /** Human: Effective instance permission slugs from GET /me/permissions. */
  instancePermissions: string[];
  setAuth: (user: User, sessionExpHint?: number | null) => void;
  logout: () => void;
  /** Human: Check delegated admin capability without relying on users.role alone. */
  hasInstancePermission: (permission: string) => boolean;
  /** Human: True when JWT role is admin or instance.admin grant is held. */
  isAdmin: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
