// Human: Shared React context value for the code editor light/dark palettes.
// Agent: READ by EditorThemeProvider; CONSUMED by useCodeEditorTheme in child panels.

import { createContext } from "react";
import type { EditorTheme, EditorThemePreference } from "@/lib/text-code-editor/theme";

export type EditorThemeContextValue = {
  theme: EditorTheme;
  preference: EditorThemePreference;
};

export const EditorThemeContext = createContext<EditorThemeContextValue | null>(null);
