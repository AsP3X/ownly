// Human: Full-viewport wrapper for login and signup — brand column plus form card over the 3D network scene.
// Agent: RENDERS AuthSceneBackground + AuthBrandPanel + children; no API calls.

import type { ReactNode } from "react";
import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { AuthSceneBackground } from "@/components/auth/AuthSceneBackground";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { cn } from "@/lib/utils";
import "./auth-motion.css";

type AuthPageShellProps = {
  children: ReactNode;
  /**
   * Which page this is — drives the brand column copy on wide screens.
   * Omit for surfaces that are not sign-in/sign-up (e.g. the public share gate);
   * the card is then centered on its own.
   */
  mode?: "login" | "register";
};

export function AuthPageShell({ children, mode }: AuthPageShellProps) {
  return (
    // Human: min-h-svh keeps the layout stable while mobile browser chrome collapses.
    // Agent: `auth-motion` carries the shared easing/duration vars used by every auth-* class.
    <div className="auth-motion relative min-h-svh w-full overflow-hidden">
      <AuthSceneBackground />

      <AuthThemeToggle className="auth-enter fixed top-4 right-4 z-20 sm:top-6 sm:right-6" />

      {/*
       * Human: One centered column on phones and tablets, brand + card side by side from lg up.
       * Agent: Card column is capped at 480px so the form never stretches on ultrawide screens.
       */}
      {/* Human: Extra top padding on phones keeps a tall card clear of the fixed theme toggle. */}
      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-6xl items-center justify-center px-4 pt-20 pb-10 sm:px-6 sm:py-10 lg:px-10">
        <div
          className={cn(
            "flex w-full flex-col items-center gap-12 lg:flex-row lg:items-center lg:gap-16",
            mode ? "lg:justify-between" : "lg:justify-center",
          )}
        >
          {mode ? <AuthBrandPanel mode={mode} /> : null}
          <div className="w-full max-w-[480px] shrink-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
