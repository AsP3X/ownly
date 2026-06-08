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
  /** Human: Effective instance permission slugs from GET /me/permissions. */
  instancePermissions: string[];
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  /** Human: Check delegated admin capability without relying on users.role alone. */
  hasInstancePermission: (permission: string) => boolean;
  /** Human: True when JWT role is admin or instance.admin grant is held. */
  isAdmin: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
