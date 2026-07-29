// Human: Monaco-powered code surface — full language services, multi-cursor, find, fold, minimap.
// Agent: MOUNTS @monaco-editor/react; SYNCS value; EXPOSES editor actions via imperative handle.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type * as MonacoNamespace from "monaco-editor";
import { Loader2 } from "lucide-react";
import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import { detectEditorLanguage } from "@/lib/text-code-editor/language";
import type { EditorPreferences } from "@/lib/text-code-editor/preferences";
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
};

export type CodeEditorSurfaceProps = {
  filename: string;
  mimeType: string | null;
  value: string;
  readOnly?: boolean;
  preferences: EditorPreferences;
  onChange: (value: string) => void;
  onCursorChange: (state: CodeEditorCursorState) => void;
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
      onSaveRequest,
      className,
    },
    ref,
  ) {
    const { theme } = useCodeEditorTheme();
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof MonacoNamespace | null>(null);
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
        onSaveRequest?.();
      });

      const emitCursor = () => {
        const model = editor.getModel();
        const position = editor.getPosition();
        const selection = editor.getSelection();
        if (!model || !position || !selection) return;
        const stats = selectionStats(model, selection);
        onCursorChange({
          lineNumber: position.lineNumber,
          column: position.column,
          ...stats,
        });
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
            onChange(next ?? "");
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
