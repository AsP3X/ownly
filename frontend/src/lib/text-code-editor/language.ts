// Human: Map stored filenames and MIME types to Monaco language ids and status labels.
// Agent: READS name + mime_type; RETURNS EditorLanguage with Monaco id, label, and default tab size.

import type { EditorThemeId } from "@/lib/text-code-editor/theme";
import { getEditorTheme } from "@/lib/text-code-editor/theme";

export type EditorLanguage = {
  /** Human: Monaco editor language id (e.g. typescript, python, plaintext). */
  id: string;
  /** Human: Status-bar label — e.g. "TypeScript JSX". */
  label: string;
  /** Human: Compact badge for optional chrome. */
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
  scss: { id: "scss", label: "SCSS", badge: "SCSS", tabSize: 2 },
  less: { id: "less", label: "Less", badge: "Less", tabSize: 2 },
  json: { id: "json", label: "JSON", badge: "JSON", tabSize: 2 },
  jsonc: { id: "json", label: "JSONC", badge: "JSONC", tabSize: 2 },
  html: { id: "html", label: "HTML", badge: "HTML", tabSize: 2 },
  htm: { id: "html", label: "HTML", badge: "HTML", tabSize: 2 },
  xml: { id: "xml", label: "XML", badge: "XML", tabSize: 2 },
  svg: { id: "xml", label: "SVG", badge: "SVG", tabSize: 2 },
  md: { id: "markdown", label: "Markdown", badge: "Markdown", tabSize: 2 },
  markdown: { id: "markdown", label: "Markdown", badge: "Markdown", tabSize: 2 },
  mdx: { id: "markdown", label: "MDX", badge: "MDX", tabSize: 2 },
  txt: { id: "plaintext", label: "Plain Text", badge: "Text", tabSize: 2 },
  log: { id: "plaintext", label: "Log", badge: "Log", tabSize: 2 },
  yaml: { id: "yaml", label: "YAML", badge: "YAML", tabSize: 2 },
  yml: { id: "yaml", label: "YAML", badge: "YAML", tabSize: 2 },
  toml: { id: "ini", label: "TOML", badge: "TOML", tabSize: 2 },
  ini: { id: "ini", label: "INI", badge: "INI", tabSize: 2 },
  conf: { id: "ini", label: "Config", badge: "Config", tabSize: 2 },
  env: { id: "ini", label: "Env", badge: "Env", tabSize: 2 },
  rs: { id: "rust", label: "Rust", badge: "Rust", tabSize: 4 },
  py: { id: "python", label: "Python", badge: "Python", tabSize: 4 },
  pyw: { id: "python", label: "Python", badge: "Python", tabSize: 4 },
  go: { id: "go", label: "Go", badge: "Go", tabSize: 4 },
  java: { id: "java", label: "Java", badge: "Java", tabSize: 4 },
  kt: { id: "kotlin", label: "Kotlin", badge: "Kotlin", tabSize: 4 },
  kts: { id: "kotlin", label: "Kotlin", badge: "Kotlin", tabSize: 4 },
  c: { id: "c", label: "C", badge: "C", tabSize: 4 },
  h: { id: "c", label: "C Header", badge: "C", tabSize: 4 },
  cpp: { id: "cpp", label: "C++", badge: "C++", tabSize: 4 },
  cc: { id: "cpp", label: "C++", badge: "C++", tabSize: 4 },
  cxx: { id: "cpp", label: "C++", badge: "C++", tabSize: 4 },
  hpp: { id: "cpp", label: "C++ Header", badge: "C++", tabSize: 4 },
  cs: { id: "csharp", label: "C#", badge: "C#", tabSize: 4 },
  php: { id: "php", label: "PHP", badge: "PHP", tabSize: 4 },
  rb: { id: "ruby", label: "Ruby", badge: "Ruby", tabSize: 2 },
  swift: { id: "swift", label: "Swift", badge: "Swift", tabSize: 4 },
  sh: { id: "shell", label: "Shell", badge: "Shell", tabSize: 2 },
  bash: { id: "shell", label: "Bash", badge: "Bash", tabSize: 2 },
  zsh: { id: "shell", label: "Zsh", badge: "Zsh", tabSize: 2 },
  fish: { id: "shell", label: "Fish", badge: "Fish", tabSize: 2 },
  ps1: { id: "powershell", label: "PowerShell", badge: "PowerShell", tabSize: 4 },
  sql: { id: "sql", label: "SQL", badge: "SQL", tabSize: 2 },
  graphql: { id: "graphql", label: "GraphQL", badge: "GraphQL", tabSize: 2 },
  gql: { id: "graphql", label: "GraphQL", badge: "GraphQL", tabSize: 2 },
  dockerfile: { id: "dockerfile", label: "Dockerfile", badge: "Docker", tabSize: 2 },
  docker: { id: "dockerfile", label: "Dockerfile", badge: "Docker", tabSize: 2 },
  r: { id: "r", label: "R", badge: "R", tabSize: 2 },
  lua: { id: "lua", label: "Lua", badge: "Lua", tabSize: 2 },
  pl: { id: "perl", label: "Perl", badge: "Perl", tabSize: 4 },
  pm: { id: "perl", label: "Perl", badge: "Perl", tabSize: 4 },
  vb: { id: "vb", label: "Visual Basic", badge: "VB", tabSize: 4 },
  vue: { id: "html", label: "Vue", badge: "Vue", tabSize: 2 },
  svelte: { id: "html", label: "Svelte", badge: "Svelte", tabSize: 2 },
  csv: { id: "plaintext", label: "CSV", badge: "CSV", tabSize: 2 },
  tsv: { id: "plaintext", label: "TSV", badge: "TSV", tabSize: 2 },
};

const MIME_LANGUAGE: Record<string, EditorLanguage> = {
  "application/javascript": EXTENSION_LANGUAGE.js,
  "text/javascript": EXTENSION_LANGUAGE.js,
  "application/typescript": EXTENSION_LANGUAGE.ts,
  "text/typescript": EXTENSION_LANGUAGE.ts,
  "application/json": EXTENSION_LANGUAGE.json,
  "text/css": EXTENSION_LANGUAGE.css,
  "text/html": EXTENSION_LANGUAGE.html,
  "text/markdown": EXTENSION_LANGUAGE.md,
  "text/plain": EXTENSION_LANGUAGE.txt,
  "text/x-python": EXTENSION_LANGUAGE.py,
  "text/x-rust": EXTENSION_LANGUAGE.rs,
  "text/x-go": EXTENSION_LANGUAGE.go,
  "text/x-java-source": EXTENSION_LANGUAGE.java,
  "text/x-sh": EXTENSION_LANGUAGE.sh,
  "text/x-shellscript": EXTENSION_LANGUAGE.sh,
  "text/x-sql": EXTENSION_LANGUAGE.sql,
  "text/yaml": EXTENSION_LANGUAGE.yaml,
  "application/x-yaml": EXTENSION_LANGUAGE.yaml,
  "application/xml": EXTENSION_LANGUAGE.xml,
  "text/xml": EXTENSION_LANGUAGE.xml,
  "text/csv": EXTENSION_LANGUAGE.csv,
};

// Human: Resolve Monaco language metadata from API mime_type with filename extension fallback.
// Agent: READS mime + name; RETURNS EditorLanguage; DEFAULT plaintext when unknown.
export function detectEditorLanguage(
  filename: string,
  mimeType: string | null | undefined,
): EditorLanguage {
  const baseName = filename.split("/").pop()?.toLowerCase() ?? filename.toLowerCase();
  if (baseName === "dockerfile" || baseName.startsWith("dockerfile.")) {
    return EXTENSION_LANGUAGE.dockerfile;
  }
  if (baseName === "makefile" || baseName === "gnumakefile") {
    return { id: "plaintext", label: "Makefile", badge: "Make", tabSize: 4 };
  }

  const mime = (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime && MIME_LANGUAGE[mime]) {
    return MIME_LANGUAGE[mime];
  }
  if (mime.includes("json")) return EXTENSION_LANGUAGE.json;
  if (mime.includes("javascript")) return EXTENSION_LANGUAGE.js;
  if (mime.includes("typescript")) return EXTENSION_LANGUAGE.ts;
  if (mime.includes("python")) return EXTENSION_LANGUAGE.py;
  if (mime.includes("rust")) return EXTENSION_LANGUAGE.rs;
  if (mime.includes("yaml")) return EXTENSION_LANGUAGE.yaml;
  if (mime.includes("markdown")) return EXTENSION_LANGUAGE.md;
  if (mime.includes("xml")) return EXTENSION_LANGUAGE.xml;
  if (mime.includes("sql")) return EXTENSION_LANGUAGE.sql;
  if (mime.startsWith("text/")) {
    // Fall through to extension so .rs/.py keep proper languages under text/* unknowns.
  }

  const extension = baseName.includes(".")
    ? (baseName.split(".").pop()?.toLowerCase() ?? "")
    : "";
  if (extension && EXTENSION_LANGUAGE[extension]) {
    return EXTENSION_LANGUAGE[extension];
  }

  return EXTENSION_LANGUAGE.txt;
}

// Human: File icon tint in the tab bar — warm gold for active code files per Pencil.
// Agent: READS filename + theme; RETURNS Tailwind text color class for lucide FileCode icon.
export function editorTabIconClass(
  filename: string,
  active: boolean,
  themeId: EditorThemeId = "dark",
): string {
  const theme = getEditorTheme(themeId);
  if (!active) return theme.tabIconInactive;
  const language = detectEditorLanguage(filename, null);
  if (language.id === "css" || language.id === "scss" || language.id === "less") {
    return theme.tabIconCss;
  }
  if (language.id === "json") return theme.tabIconJson;
  return theme.tabIconJs;
}
