// Human: In-browser text/code editor dialog — Pencil Code Editor Dialog with tabs, search, and save.
// Agent: FETCHES fetchFileBlobForPreview; EDITS local buffer; SAVE replaceTextFileContent when allowed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  fetchFileBlobForPreview,
  fetchPublicShareBlobForPreview,
  getErrorMessage,
  replaceTextFileContent,
} from "@/api/client";
import { CodeEditorHeader } from "@/components/drive/text-code-editor/CodeEditorHeader";
import { CodeEditorStatusBar } from "@/components/drive/text-code-editor/CodeEditorStatusBar";
import { CodeEditorSurface } from "@/components/drive/text-code-editor/CodeEditorSurface";
import { EditorSearchPanel } from "@/components/drive/text-code-editor/EditorSearchPanel";
import { EditorSettingsPanel } from "@/components/drive/text-code-editor/EditorSettingsPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { detectEditorLanguage } from "@/lib/text-code-editor/language";
import {
  applyTextReplacement,
  caretPositionFromIndex,
  findTextMatches,
} from "@/lib/text-code-editor/search";

export type TextCodeEditorDialogProps = {
  tabs: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (file: FileItem) => void;
  onFileSaved?: (previousId: string, file: FileItem) => void;
  /** Human: Parent folder label shown in the status bar as the git-branch analogue. */
  branchLabel?: string;
  /** When set, bytes load through anonymous public share download (read-only). */
  shareToken?: string;
  sharePassword?: string | null;
};

type EditorBuffer = {
  value: string;
  savedValue: string;
  loading: boolean;
  error: string;
};

function emptyBuffer(): EditorBuffer {
  return { value: "", savedValue: "", loading: false, error: "" };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export function TextCodeEditorDialog({
  tabs,
  file,
  open,
  onOpenChange,
  onFileChange,
  onFileSaved,
  branchLabel = "cloud",
  shareToken,
  sharePassword,
}: TextCodeEditorDialogProps) {
  const readOnly = Boolean(shareToken);
  const [openTabs, setOpenTabs] = useState<FileItem[]>(tabs);
  const [buffers, setBuffers] = useState<Record<string, EditorBuffer>>({});
  const [wordWrap, setWordWrap] = useState(false);
  const [tabSize, setTabSize] = useState(2);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [replaceExpanded, setReplaceExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [selectionStart, setSelectionStart] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const activeFileIdRef = useRef<string | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setOpenTabs(tabs);
  }, [open, tabs]);

  const activeFile = file;
  const activeBuffer = activeFile ? buffers[activeFile.id] ?? emptyBuffer() : emptyBuffer();
  const activeLanguage = activeFile
    ? detectEditorLanguage(activeFile.name, activeFile.mime_type)
    : detectEditorLanguage("untitled.txt", "text/plain");

  const searchMatches = useMemo(
    () => findTextMatches(activeBuffer.value, searchQuery, caseSensitive),
    [activeBuffer.value, searchQuery, caseSensitive],
  );

  const dirty = activeBuffer.value !== activeBuffer.savedValue;

  const syncLabel = saveError
    ? saveError
    : saving
      ? "Saving to cloud…"
      : dirty
        ? "Unsaved changes"
        : "Auto-saved to cloud";

  const syncTone = saveError ? "error" : saving ? "saving" : dirty ? "dirty" : "saved";

  const cursorLabel = useMemo(() => {
    const { line, column } = caretPositionFromIndex(activeBuffer.value, selectionStart);
    return `Ln ${line}, Col ${column}`;
  }, [activeBuffer.value, selectionStart]);

  const loadFileContent = useCallback(
    async (target: FileItem) => {
      activeFileIdRef.current = target.id;
      setBuffers((current) => ({
        ...current,
        [target.id]: {
          ...(current[target.id] ?? emptyBuffer()),
          loading: true,
          error: "",
        },
      }));

      try {
        const blob = shareToken
          ? await fetchPublicShareBlobForPreview(shareToken, target.id, sharePassword)
          : await fetchFileBlobForPreview(target);
        if (activeFileIdRef.current !== target.id) return;
        const text = await blob.text();
        setBuffers((current) => ({
          ...current,
          [target.id]: {
            value: text,
            savedValue: text,
            loading: false,
            error: "",
          },
        }));
      } catch (error) {
        if (activeFileIdRef.current !== target.id) return;
        setBuffers((current) => ({
          ...current,
          [target.id]: {
            ...(current[target.id] ?? emptyBuffer()),
            loading: false,
            error: getErrorMessage(error),
          },
        }));
      }
    },
    [sharePassword, shareToken],
  );

  useEffect(() => {
    if (!open || !activeFile) return;
    const cached = buffers[activeFile.id];
    if (cached && (cached.loading || cached.savedValue !== "" || cached.error)) return;
    void loadFileContent(activeFile);
  }, [activeFile, buffers, loadFileContent, open]);

  useEffect(() => {
    if (!open) return;
    setSearchOpen(false);
    setSettingsOpen(false);
    setSaveError("");
  }, [activeFile?.id, open]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveSearchMatchIndex(0);
      return;
    }
    setActiveSearchMatchIndex((current) => Math.min(current, searchMatches.length - 1));
  }, [searchMatches.length, searchQuery, caseSensitive]);

  const handleCloseRequest = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      if (dirty && !readOnly) {
        const confirmed = window.confirm("Discard unsaved changes?");
        if (!confirmed) return;
      }
      onOpenChange(false);
    },
    [dirty, onOpenChange, readOnly],
  );

  const handleSelectTab = useCallback(
    (nextFile: FileItem) => {
      if (nextFile.id === activeFile?.id) return;
      onFileChange(nextFile);
    },
    [activeFile?.id, onFileChange],
  );

  const handleCloseTab = useCallback(
    (closing: FileItem) => {
      const closingBuffer = buffers[closing.id] ?? emptyBuffer();
      const closingDirty = closingBuffer.value !== closingBuffer.savedValue;
      if (closingDirty && !readOnly) {
        const confirmed = window.confirm(`Discard unsaved changes in ${closing.name}?`);
        if (!confirmed) return;
      }

      const remaining = openTabs.filter((tab) => tab.id !== closing.id);
      setOpenTabs(remaining);
      setBuffers((current) => {
        const next = { ...current };
        delete next[closing.id];
        return next;
      });

      if (closing.id === activeFile?.id) {
        if (remaining.length > 0) {
          onFileChange(remaining[0]);
        } else {
          onOpenChange(false);
        }
      }
    },
    [activeFile?.id, buffers, onFileChange, onOpenChange, openTabs, readOnly],
  );

  const handleValueChange = useCallback((nextValue: string) => {
    if (!activeFile || readOnly) return;
    setSaveError("");
    setBuffers((current) => ({
      ...current,
      [activeFile.id]: {
        ...(current[activeFile.id] ?? emptyBuffer()),
        value: nextValue,
      },
    }));
  }, [activeFile, readOnly]);

  const handleSave = useCallback(async () => {
    if (!activeFile || readOnly || saving || !dirty) return;
    setSaving(true);
    setSaveError("");
    try {
      const { file: savedFile } = await replaceTextFileContent(activeFile, activeBuffer.value);
      setBuffers((current) => {
        const next = { ...current };
        delete next[activeFile.id];
        next[savedFile.id] = {
          value: activeBuffer.value,
          savedValue: activeBuffer.value,
          loading: false,
          error: "",
        };
        return next;
      });
      setOpenTabs((current) =>
        current.map((tab) => (tab.id === activeFile.id ? savedFile : tab)),
      );
      onFileSaved?.(activeFile.id, savedFile);
      onFileChange(savedFile);
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [activeBuffer.value, activeFile, dirty, onFileChange, onFileSaved, readOnly, saving]);

  const handleReplaceOne = useCallback(() => {
    if (!activeFile || readOnly || searchMatches.length === 0) return;
    const result = applyTextReplacement(
      activeBuffer.value,
      searchQuery,
      replaceValue,
      caseSensitive,
      activeSearchMatchIndex,
      false,
    );
    handleValueChange(result.nextValue);
  }, [
    activeBuffer.value,
    activeFile,
    activeSearchMatchIndex,
    caseSensitive,
    handleValueChange,
    readOnly,
    replaceValue,
    searchMatches.length,
    searchQuery,
  ]);

  const handleReplaceAll = useCallback(() => {
    if (!activeFile || readOnly || searchMatches.length === 0) return;
    const result = applyTextReplacement(
      activeBuffer.value,
      searchQuery,
      replaceValue,
      caseSensitive,
      activeSearchMatchIndex,
      true,
    );
    handleValueChange(result.nextValue);
    setActiveSearchMatchIndex(0);
  }, [
    activeBuffer.value,
    activeFile,
    activeSearchMatchIndex,
    caseSensitive,
    handleValueChange,
    readOnly,
    replaceValue,
    searchMatches.length,
    searchQuery,
  ]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) && !(event.metaKey || event.ctrlKey)) {
        if (event.key === "Escape" && searchOpen) {
          event.preventDefault();
          setSearchOpen(false);
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        setSettingsOpen(false);
        window.requestAnimationFrame(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, open, searchOpen]);

  return (
    <Dialog open={open} onOpenChange={handleCloseRequest}>
      <DialogContent
        className="flex w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-visible border-0 bg-transparent p-4 shadow-none ring-0 sm:max-w-[75rem]"
        overlayClassName="bg-[#0B0F19]/60 backdrop-blur-[2px]"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{activeFile?.name ?? "Text editor"}</DialogTitle>
          <DialogDescription>
            View and edit text files with syntax highlighting, search, and cloud save.
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex h-[min(913px,90dvh)] w-full flex-col overflow-hidden rounded-2xl border border-[#313244] bg-[#1E1E2E] shadow-[0_12px_32px_rgba(0,0,0,0.1)]">
          <CodeEditorHeader
            tabs={openTabs}
            activeFileId={activeFile?.id ?? null}
            wordWrap={wordWrap}
            searchOpen={searchOpen}
            settingsOpen={settingsOpen}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onToggleWordWrap={() => setWordWrap((current) => !current)}
            onToggleSearch={() => {
              setSearchOpen((current) => !current);
              setSettingsOpen(false);
            }}
            onToggleSettings={() => {
              setSettingsOpen((current) => !current);
              setSearchOpen(false);
            }}
          />

          <EditorSettingsPanel
            open={settingsOpen}
            tabSize={tabSize}
            wordWrap={wordWrap}
            onTabSizeChange={setTabSize}
            onWordWrapChange={setWordWrap}
          />

          <div className="relative flex min-h-0 flex-1 flex-col">
            {activeBuffer.loading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#A6ADC8]">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                Loading file…
              </div>
            ) : null}

            {activeBuffer.error ? (
              <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#EF4444]" role="alert">
                {activeBuffer.error}
              </p>
            ) : null}

            {!activeBuffer.loading && !activeBuffer.error && activeFile ? (
              <>
                <EditorSearchPanel
                  open={searchOpen}
                  findInputRef={findInputRef}
                  query={searchQuery}
                  replaceValue={replaceValue}
                  caseSensitive={caseSensitive}
                  matchCount={searchMatches.length}
                  activeMatchIndex={activeSearchMatchIndex}
                  replaceExpanded={replaceExpanded}
                  onQueryChange={setSearchQuery}
                  onReplaceChange={setReplaceValue}
                  onToggleCaseSensitive={() => setCaseSensitive((current) => !current)}
                  onToggleReplaceExpanded={() => setReplaceExpanded((current) => !current)}
                  onPreviousMatch={() =>
                    setActiveSearchMatchIndex((current) =>
                      searchMatches.length === 0
                        ? 0
                        : (current - 1 + searchMatches.length) % searchMatches.length,
                    )
                  }
                  onNextMatch={() =>
                    setActiveSearchMatchIndex((current) =>
                      searchMatches.length === 0 ? 0 : (current + 1) % searchMatches.length,
                    )
                  }
                  onClose={() => setSearchOpen(false)}
                  onReplaceOne={handleReplaceOne}
                  onReplaceAll={handleReplaceAll}
                />

                <CodeEditorSurface
                  filename={activeFile.name}
                  mimeType={activeFile.mime_type}
                  value={activeBuffer.value}
                  readOnly={readOnly}
                  wordWrap={wordWrap}
                  tabSize={tabSize}
                  searchMatches={searchOpen ? searchMatches : []}
                  activeSearchMatchIndex={searchOpen ? activeSearchMatchIndex : 0}
                  onChange={handleValueChange}
                  onSelectionChange={(start) => setSelectionStart(start)}
                />
              </>
            ) : null}
          </div>

          <CodeEditorStatusBar
            branchLabel={branchLabel}
            syncLabel={syncLabel}
            syncTone={syncTone}
            cursorLabel={cursorLabel}
            languageLabel={activeLanguage.label}
            tabSizeLabel={`Spaces: ${tabSize}`}
            readOnly={readOnly}
            saving={saving}
            canSave={dirty && !activeBuffer.loading && !activeBuffer.error}
            onClose={() => handleCloseRequest(false)}
            onSave={() => void handleSave()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
