// Human: Page frame for the first-run wizard — product bar, step list, and the form panel.
// Agent: RENDERS layout only; no API calls. Deliberately plain: this is a configuration tool, not a landing page.

import type { ReactNode } from "react";
import { Cloud } from "lucide-react";
import { SetupThemeToggle } from "@/components/setup/SetupThemeToggle";

type SetupPageShellProps = {
  children: ReactNode;
  /** Human: Wide-screen step list; it hides itself below lg. */
  steps?: ReactNode;
};

export function SetupPageShell({ children, steps }: SetupPageShellProps) {
  return (
    // Human: min-h-svh keeps the layout stable while mobile browser chrome collapses.
    <div className="flex min-h-svh flex-col bg-surface text-ink">
      <header className="border-b border-edge bg-panel">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-2.5 sm:px-5 sm:py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-on"
              aria-hidden
            >
              <Cloud className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Ownly</span>
            <span className="text-sm text-ink-faint">Setup</span>
          </div>
          <SetupThemeToggle />
        </div>
      </header>

      {/* Human: Tighter gutters and top padding on phones — the wizard is long enough already. */}
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-5 sm:px-5 sm:py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
          {steps ? <div className="lg:w-44 lg:shrink-0 lg:pt-1">{steps}</div> : null}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
