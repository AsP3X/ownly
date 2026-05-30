// Human: Full-viewport wrapper for the first-run setup wizard — white canvas per login-signup.pencil.
// Agent: RENDERS children only; no API calls; matches setup frames background (#FFFFFF).

import type { ReactNode } from "react";

type SetupPageShellProps = {
  children: ReactNode;
};

export function SetupPageShell({ children }: SetupPageShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-10">
      {children}
    </div>
  );
}
