// Human: Hook for reading the active editor palette inside themed child components.
// Agent: READS EditorThemeContext; THROWS when used outside EditorThemeProvider.

import { useContext } from "react";
import { EditorThemeContext } from "@/components/drive/text-code-editor/editorThemeContext";

export function useCodeEditorTheme() {
  const value = useContext(EditorThemeContext);
  if (!value) {
    throw new Error("useCodeEditorTheme must be used within EditorThemeProvider");
  }
  return value;
}
