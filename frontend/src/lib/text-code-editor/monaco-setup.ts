// Human: Load Monaco from the app bundle — avoid CDN fetches for the privacy-first editor.
// Agent: CALLS loader.config once; IMPORTED by TextCodeEditorDialog before Editor mounts.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";

let configured = false;

// Human: Point @monaco-editor/react at the local monaco-editor package.
// Agent: IDEMPOTENT config; safe to import from the dynamically loaded dialog chunk.
export function configureLocalMonaco(): void {
  if (configured) return;
  loader.config({ monaco });
  configured = true;
}
