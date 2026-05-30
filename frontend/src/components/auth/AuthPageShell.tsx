// Human: Full-viewport wrapper for login and signup — centers the form card on a clean white canvas.
// Agent: RENDERS children only; no API calls; matches login-signup.pencil page background (#FFFFFF).

import type { ReactNode } from "react";

type AuthPageShellProps = {
  children: ReactNode;
};

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      {children}
    </div>
  );
}
