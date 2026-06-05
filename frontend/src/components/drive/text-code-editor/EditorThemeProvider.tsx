// Human: Supplies resolved editor chrome tokens to header, surface, and panel children.
// Agent: PROVIDES EditorTheme from preference via EditorThemeContext.

import { useMemo, type ReactNode } from "react";
import { EditorThemeContext } from "@/components/drive/text-code-editor/editorThemeContext";
import {
  getEditorTheme,
  resolveEditorThemeId,
  type EditorThemePreference,
} from "@/lib/text-code-editor/theme";

export type EditorThemeProviderProps = {
  preference: EditorThemePreference;
  children: ReactNode;
};

export function EditorThemeProvider({ preference, children }: EditorThemeProviderProps) {
  const value = useMemo(() => {
    const themeId = resolveEditorThemeId(preference);
    return {
      theme: getEditorTheme(themeId),
      preference,
    };
  }, [preference]);

  return <EditorThemeContext.Provider value={value}>{children}</EditorThemeContext.Provider>;
}
