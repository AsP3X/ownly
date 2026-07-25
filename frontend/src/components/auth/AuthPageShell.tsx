// Human: Full-viewport wrapper for login and signup — centers the form over a soft animated scene.
// Agent: RENDERS AuthSceneBackground + children; theme from prop or ?scene= query; no API calls.

import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthSceneBackground } from "@/components/auth/AuthSceneBackground";
import {
  DEFAULT_AUTH_SCENE_THEME,
  type AuthSceneThemeId,
} from "@/lib/auth-scene-themes";

type AuthPageShellProps = {
  children: ReactNode;
  /** Force a scene theme; otherwise uses ?scene= or time-of-day auto. */
  sceneTheme?: AuthSceneThemeId | string | null;
  /** When true, skip clock-based auto theme if no explicit scene is set. */
  disableAutoScene?: boolean;
};

export function AuthPageShell({
  children,
  sceneTheme,
  disableAutoScene = false,
}: AuthPageShellProps) {
  const [params] = useSearchParams();
  const queryScene = params.get("scene");

  const resolvedTheme = useMemo(() => {
    if (sceneTheme) return sceneTheme;
    if (queryScene) return queryScene;
    return null;
  }, [sceneTheme, queryScene]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <AuthSceneBackground
        themeId={resolvedTheme}
        disableAutoTheme={disableAutoScene && !resolvedTheme}
      />
      <div className="relative z-10 w-full max-w-[480px]">{children}</div>
    </div>
  );
}

export { DEFAULT_AUTH_SCENE_THEME };
