// Human: Map stored filenames and MIME types to editor language metadata for tabs and status bar.
// Agent: READS name + mime_type; RETURNS EditorLanguage with display label and highlight mode id.

export type EditorHighlightMode =
  | "javascript"
  | "typescript"
  | "css"
  | "json"
  | "html"
  | "markdown"
  | "plain";

export type EditorLanguage = {
  id: EditorHighlightMode;
  /** Human: Status-bar label — matches Pencil "JavaScript JSX" style strings. */
  label: string;
  /** Human: Compact badge for optional chrome — e.g. "React / JS". */
  badge: string;
  tabSize: number;
};

const EXTENSION_LANGUAGE: Record<string, EditorLanguage> = {
  js: { id: "javascript", label: "JavaScript", badge: "JavaScript", tabSize: 2 },
  jsx: { id: "javascript", label: "JavaScript JSX", badge: "React / JS", tabSize: 2 },
  mjs: { id: "javascript", label: "JavaScript", badge: "JavaScript", tabSize: 2 },
  cjs: { id: "javascript", label: "JavaScript", badge: "JavaScript", tabSize: 2 },
  ts: { id: "typescript", label: "TypeScript", badge: "TypeScript", tabSize: 2 },
  tsx: { id: "typescript", label: "TypeScript JSX", badge: "React / TS", tabSize: 2 },
  css: { id: "css", label: "CSS", badge: "CSS", tabSize: 2 },
  scss: { id: "css", label: "SCSS", badge: "SCSS", tabSize: 2 },
  json: { id: "json", label: "JSON", badge: "JSON", tabSize: 2 },
  html: { id: "html", label: "HTML", badge: "HTML", tabSize: 2 },
  htm: { id: "html", label: "HTML", badge: "HTML", tabSize: 2 },
  xml: { id: "html", label: "XML", badge: "XML", tabSize: 2 },
  md: { id: "markdown", label: "Markdown", badge: "Markdown", tabSize: 2 },
  markdown: { id: "markdown", label: "Markdown", badge: "Markdown", tabSize: 2 },
  txt: { id: "plain", label: "Plain Text", badge: "Text", tabSize: 2 },
  log: { id: "plain", label: "Plain Text", badge: "Text", tabSize: 2 },
  yaml: { id: "plain", label: "YAML", badge: "YAML", tabSize: 2 },
  yml: { id: "plain", label: "YAML", badge: "YAML", tabSize: 2 },
  rs: { id: "plain", label: "Rust", badge: "Rust", tabSize: 4 },
  py: { id: "plain", label: "Python", badge: "Python", tabSize: 4 },
  sh: { id: "plain", label: "Shell", badge: "Shell", tabSize: 2 },
  sql: { id: "plain", label: "SQL", badge: "SQL", tabSize: 2 },
};

const MIME_LANGUAGE: Record<string, EditorLanguage> = {
  "application/javascript": EXTENSION_LANGUAGE.js,
  "application/json": EXTENSION_LANGUAGE.json,
  "text/css": EXTENSION_LANGUAGE.css,
  "text/html": EXTENSION_LANGUAGE.html,
  "text/markdown": EXTENSION_LANGUAGE.md,
  "text/plain": EXTENSION_LANGUAGE.txt,
  "text/x-rust": EXTENSION_LANGUAGE.rs,
};

// Human: Resolve highlight metadata from API mime_type with filename extension fallback.
// Agent: READS mime + name; RETURNS EditorLanguage; DEFAULT plain text when unknown.
export function detectEditorLanguage(
  filename: string,
  mimeType: string | null | undefined,
): EditorLanguage {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime && MIME_LANGUAGE[mime]) {
    return MIME_LANGUAGE[mime];
  }
  if (mime.includes("json")) return EXTENSION_LANGUAGE.json;
  if (mime.includes("javascript")) return EXTENSION_LANGUAGE.js;
  if (mime.includes("typescript")) return EXTENSION_LANGUAGE.ts;
  if (mime.startsWith("text/")) return EXTENSION_LANGUAGE.txt;

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension && EXTENSION_LANGUAGE[extension]) {
    return EXTENSION_LANGUAGE[extension];
  }

  return EXTENSION_LANGUAGE.txt;
}

// Human: File icon tint in the tab bar — warm gold for active code files per Pencil.
// Agent: READS filename; RETURNS Tailwind text color class for lucide FileCode icon.
export function editorTabIconClass(filename: string, active: boolean): string {
  if (!active) return "text-[#565F89]";
  const language = detectEditorLanguage(filename, null);
  if (language.id === "css") return "text-[#61AFEF]";
  if (language.id === "json") return "text-[#98C379]";
  return "text-[#E5C07B]";
}
