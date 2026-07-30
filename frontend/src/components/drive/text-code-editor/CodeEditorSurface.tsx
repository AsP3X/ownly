// Human: Monaco-powered code surface — full language services, multi-cursor, find, fold, minimap.
// Agent: MOUNTS @monaco-editor/react; SYNCS value; EXPOSES editor actions + collab remote apply/presence.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type * as MonacoNamespace from "monaco-editor";
import { Loader2 } from "lucide-react";
import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import { detectEditorLanguage } from "@/lib/text-code-editor/language";
import type { EditorPreferences } from "@/lib/text-code-editor/preferences";
import {
  scalarToUtf16Index,
  utf16ToScalarIndex,
  type RemotePresenceRange,
} from "@/lib/text-code-editor/collab-monaco";
import type { TextReplace } from "@/lib/collab/ot/text";
import { cn } from "@/lib/utils";

export type CodeEditorCursorState = {
  lineNumber: number;
  column: number;
  selectedChars: number;
  selectedLines: number;
};

export type CodeEditorSurfaceHandle = {
  focus: () => void;
  revealLine: (lineNumber: number) => void;
  triggerFind: () => void;
  triggerReplace: () => void;
  triggerGoToLine: () => void;
  triggerCommandPalette: () => void;
  triggerFormatDocument: () => Promise<void>;
  triggerFoldAll: () => void;
  triggerUnfoldAll: () => void;
  getValue: () => string;
  /** Human: Apply a collab OT replace without re-publishing (sets applying-remote guard). */
  applyRemoteReplace: (op: TextReplace) => string | null;
  /** Human: Set remote caret/selection decorations from collaborators. */
  setRemotePresence: (ranges: RemotePresenceRange[]) => void;
  /** Human: Replace full document text without re-publishing (late join). */
  setValueFromRemote: (next: string) => void;
};

export type CodeEditorSurfaceProps = {
  filename: string;
  mimeType: string | null;
  value: string;
  readOnly?: boolean;
  preferences: EditorPreferences;
  onChange: (value: string) => void;
  onCursorChange: (state: CodeEditorCursorState) => void;
  /** Human: Selection as unicode scalar offsets for collab presence. */
  onCollabSelectionChange?: (start: number, end: number) => void;
  onSaveRequest?: () => void;
  className?: string;
};

type EditorSelectionLike = {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
};

function selectionStats(
  model: MonacoEditor.ITextModel,
  selection: EditorSelectionLike,
): Pick<CodeEditorCursorState, "selectedChars" | "selectedLines"> {
  const start = model.getOffsetAt({
    lineNumber: selection.selectionStartLineNumber,
    column: selection.selectionStartColumn,
  });
  const end = model.getOffsetAt({
    lineNumber: selection.positionLineNumber,
    column: selection.positionColumn,
  });
  const selectedChars = Math.abs(end - start);
  const selectedLines =
    selectedChars === 0
      ? 0
      : Math.abs(selection.positionLineNumber - selection.selectionStartLineNumber) + 1;
  return { selectedChars, selectedLines };
}

function ensurePresenceStyle(userId: string, color: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const className = `ownly-collab-sel-${safeId}`;
  const styleId = `ownly-collab-style-${safeId}`;
  if (typeof document !== "undefined" && !document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .${className} {
        background-color: ${color}33;
      }
      .${className}-cursor {
        border-left: 2px solid ${color};
        margin-left: -1px;
        pointer-events: none;
      }
      .${className}-label {
        background-color: ${color};
        color: #fff;
        font-size: 10px;
        line-height: 1;
        padding: 1px 4px;
        border-radius: 2px;
        white-space: nowrap;
        pointer-events: none;
        position: relative;
        top: -1.1em;
        margin-left: -2px;
      }
    `;
    document.head.appendChild(style);
  }
  return className;
}

export const CodeEditorSurface = forwardRef<CodeEditorSurfaceHandle, CodeEditorSurfaceProps>(
  function CodeEditorSurface(
    {
      filename,
      mimeType,
      value,
      readOnly = false,
      preferences,
      onChange,
      onCursorChange,
      onCollabSelectionChange,
      onSaveRequest,
      className,
    },
    ref,
  ) {
    const { theme } = useCodeEditorTheme();
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof MonacoNamespace | null>(null);
    const applyingRemoteRef = useRef(false);
    const decorationsRef = useRef<string[]>([]);
    const onChangeRef = useRef(onChange);
    const onCursorChangeRef = useRef(onCursorChange);
    const onCollabSelectionChangeRef = useRef(onCollabSelectionChange);
    const onSaveRequestRef = useRef(onSaveRequest);
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
    onCollabSelectionChangeRef.current = onCollabSelectionChange;
    onSaveRequestRef.current = onSaveRequest;

    const monacoTheme = theme.id === "dark" ? "vs-dark" : "vs";
    const language = useMemo(
      () => detectEditorLanguage(filename, mimeType),
      [filename, mimeType],
    );

    const editorOptions = useMemo<MonacoEditor.IStandaloneEditorConstructionOptions>(
      () => ({
        readOnly,
        fontSize: preferences.fontSize,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontLigatures: true,
        lineNumbers: preferences.lineNumbers ? "on" : "off",
        lineNumbersMinChars: 3,
        glyphMargin: true,
        folding: true,
        foldingHighlight: true,
        showFoldingControls: "mouseover",
        wordWrap: preferences.wordWrap ? "on" : "off",
        wrappingIndent: "same",
        minimap: {
          enabled: preferences.minimap,
          showSlider: "mouseover",
          renderCharacters: false,
          maxColumn: 120,
        },
        scrollBeyondLastLine: false,
        smoothScrolling: preferences.smoothScrolling,
        cursorBlinking: preferences.cursorBlinking,
        cursorSmoothCaretAnimation: "on",
        renderWhitespace: preferences.renderWhitespace,
        renderLineHighlight: "all",
        renderLineHighlightOnlyWhenFocus: false,
        bracketPairColorization: { enabled: preferences.bracketPairColorization },
        guides: {
          bracketPairs: preferences.bracketPairColorization,
          indentation: true,
          highlightActiveIndentation: true,
        },
        stickyScroll: { enabled: preferences.stickyScroll },
        automaticLayout: true,
        tabSize: preferences.tabSize,
        insertSpaces: preferences.insertSpaces,
        detectIndentation: false,
        formatOnPaste: preferences.formatOnPaste && !readOnly,
        formatOnType: preferences.formatOnType && !readOnly,
        autoClosingBrackets: "languageDefined",
        autoClosingQuotes: "languageDefined",
        autoIndent: "full",
        matchBrackets: "always",
        links: true,
        multiCursorModifier: "alt",
        accessibilitySupport: "auto",
        padding: { top: 12, bottom: 12 },
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
          useShadows: false,
        },
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: "multiline",
          seedSearchStringFromSelection: "selection",
        },
        quickSuggestions: !readOnly,
        suggestOnTriggerCharacters: !readOnly,
        acceptSuggestionOnEnter: "on",
        tabCompletion: "on",
        wordBasedSuggestions: readOnly ? "off" : "matchingDocuments",
        contextmenu: true,
        mouseWheelZoom: true,
        dragAndDrop: !readOnly,
        emptySelectionClipboard: true,
        copyWithSyntaxHighlighting: true,
        unicodeHighlight: {
          ambiguousCharacters: true,
          invisibleCharacters: true,
        },
      }),
      [preferences, readOnly],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        revealLine: (lineNumber: number) => {
          const editor = editorRef.current;
          if (!editor) return;
          editor.revealLineInCenter(lineNumber);
          editor.setPosition({ lineNumber, column: 1 });
          editor.focus();
        },
        triggerFind: () => {
          editorRef.current?.getAction("actions.find")?.run();
        },
        triggerReplace: () => {
          editorRef.current?.getAction("editor.action.startFindReplaceAction")?.run();
        },
        triggerGoToLine: () => {
          editorRef.current?.getAction("editor.action.gotoLine")?.run();
        },
        triggerCommandPalette: () => {
          editorRef.current?.getAction("editor.action.quickCommand")?.run();
        },
        triggerFormatDocument: async () => {
          await editorRef.current?.getAction("editor.action.formatDocument")?.run();
        },
        triggerFoldAll: () => {
          editorRef.current?.getAction("editor.foldAll")?.run();
        },
        triggerUnfoldAll: () => {
          editorRef.current?.getAction("editor.unfoldAll")?.run();
        },
        getValue: () => editorRef.current?.getValue() ?? value,
        applyRemoteReplace: (op) => {
          const editor = editorRef.current;
          const model = editor?.getModel();
          const monaco = monacoRef.current;
          if (!editor || !model || !monaco) return null;
          const text = model.getValue();
          const startUtf16 = scalarToUtf16Index(text, op.index);
          const endUtf16 = scalarToUtf16Index(text, op.index + op.delete);
          const start = model.getPositionAt(startUtf16);
          const end = model.getPositionAt(endUtf16);
          applyingRemoteRef.current = true;
          try {
            editor.executeEdits("ownly-collab-remote", [
              {
                range: new monaco.Range(
                  start.lineNumber,
                  start.column,
                  end.lineNumber,
                  end.column,
                ),
                text: op.insert,
                forceMoveMarkers: true,
              },
            ]);
            return model.getValue();
          } finally {
            applyingRemoteRef.current = false;
          }
        },
        setValueFromRemote: (next) => {
          const editor = editorRef.current;
          const model = editor?.getModel();
          if (!editor || !model) return;
          if (model.getValue() === next) return;
          applyingRemoteRef.current = true;
          try {
            const full = model.getFullModelRange();
            editor.executeEdits("ownly-collab-remote-full", [
              { range: full, text: next, forceMoveMarkers: true },
            ]);
          } finally {
            applyingRemoteRef.current = false;
          }
        },
        setRemotePresence: (ranges) => {
          const editor = editorRef.current;
          const model = editor?.getModel();
          const monaco = monacoRef.current;
          if (!editor || !model || !monaco) return;
          const text = model.getValue();
          const next: MonacoEditor.IModelDeltaDecoration[] = [];
          for (const person of ranges) {
            const classBase = ensurePresenceStyle(person.userId, person.color);
            const startUtf16 = scalarToUtf16Index(text, Math.min(person.start, person.end));
            const endUtf16 = scalarToUtf16Index(text, Math.max(person.start, person.end));
            const start = model.getPositionAt(Math.min(startUtf16, text.length));
            const end = model.getPositionAt(Math.min(endUtf16, text.length));
            const collapsed = startUtf16 === endUtf16;
            next.push({
              range: new monaco.Range(
                start.lineNumber,
                start.column,
                end.lineNumber,
                end.column,
              ),
              options: {
                className: collapsed ? undefined : classBase,
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                beforeContentClassName: collapsed ? `${classBase}-cursor` : undefined,
                afterContentClassName: undefined,
                hoverMessage: person.label
                  ? { value: person.label }
                  : undefined,
                overviewRuler: {
                  color: person.color,
                  position: monaco.editor.OverviewRulerLane.Right,
                },
                minimap: {
                  color: person.color,
                  position: monaco.editor.MinimapPosition.Inline,
                },
              },
            });
            if (person.label) {
              next.push({
                range: new monaco.Range(start.lineNumber, start.column, start.lineNumber, start.column),
                options: {
                  stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                  after: {
                    content: ` ${person.label} `,
                    inlineClassName: `${classBase}-label`,
                  },
                },
              });
            }
          }
          decorationsRef.current = editor.deltaDecorations(decorationsRef.current, next);
        },
      }),
      [value],
    );

    // Human: Apply live preference changes without remounting the Monaco instance.
    // Agent: CALLS editor.updateOptions when preferences or readOnly change.
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.updateOptions(editorOptions);
      const model = editor.getModel();
      if (model) {
        model.updateOptions({
          tabSize: preferences.tabSize,
          insertSpaces: preferences.insertSpaces,
        });
      }
    }, [editorOptions, preferences.insertSpaces, preferences.tabSize]);

    // Human: Switch Monaco color theme when the Ownly light/dark preference changes.
    // Agent: CALLS monaco.editor.setTheme from the mounted monaco instance.
    useEffect(() => {
      monacoRef.current?.editor.setTheme(monacoTheme);
    }, [monacoTheme]);

    const handleMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      monaco.editor.setTheme(monacoTheme);

      // Human: Ctrl/Cmd+S saves to cloud — Monaco must not swallow it without a handler.
      // Agent: ADD command that CALLS onSaveRequest; KEEP find/replace as Monaco defaults.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRequestRef.current?.();
      });

      const emitCursor = () => {
        const model = editor.getModel();
        const position = editor.getPosition();
        const selection = editor.getSelection();
        if (!model || !position || !selection) return;
        const stats = selectionStats(model, selection);
        onCursorChangeRef.current({
          lineNumber: position.lineNumber,
          column: position.column,
          ...stats,
        });
        const text = model.getValue();
        const a = model.getOffsetAt({
          lineNumber: selection.selectionStartLineNumber,
          column: selection.selectionStartColumn,
        });
        const b = model.getOffsetAt({
          lineNumber: selection.positionLineNumber,
          column: selection.positionColumn,
        });
        const start = utf16ToScalarIndex(text, Math.min(a, b));
        const end = utf16ToScalarIndex(text, Math.max(a, b));
        onCollabSelectionChangeRef.current?.(start, end);
      };

      editor.onDidChangeCursorPosition(emitCursor);
      editor.onDidChangeCursorSelection(emitCursor);
      emitCursor();
      editor.focus();
    };

    return (
      <div className={cn("relative min-h-0 flex-1 overflow-hidden", theme.surface, className)}>
        <Editor
          height="100%"
          language={language.id}
          theme={monacoTheme}
          value={value}
          path={`inmemory://ownly/${encodeURIComponent(filename)}`}
          options={editorOptions}
          onMount={handleMount}
          onChange={(next) => {
            if (readOnly) return;
            if (applyingRemoteRef.current) {
              // Still sync buffer so parent matches model, but parent skips publish.
              onChangeRef.current(next ?? "");
              return;
            }
            onChangeRef.current(next ?? "");
          }}
          loading={
            <div
              className={cn(
                "flex h-full items-center justify-center gap-2 text-sm",
                theme.loadingText,
              )}
            >
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Loading editor…
            </div>
          }
        />
      </div>
    );
  },
);
