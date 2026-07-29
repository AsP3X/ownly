// Human: Load Monaco from the app bundle — avoid CDN fetches for the privacy-first editor.
// Agent: CALLS loader.config once; IMPORTED by TextCodeEditorDialog before Editor mounts.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// Human: Stylesheet resolved via vite alias — package exports block min/*.css under Rolldown.
// Agent: Side-effect CSS import; path aliased in vite.config.ts to node_modules min file.
import "monaco-editor/min/vs/editor/editor.main.css";

let configured = false;

// Human: Point @monaco-editor/react at the local monaco-editor package.
// Agent: IDEMPOTENT config; safe to import from the dynamically loaded dialog chunk.
export function configureLocalMonaco(): void {
  if (configured) return;
  loader.config({ monaco });
  configured = true;
}
