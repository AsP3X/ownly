// Human: Full-viewport text/code editor — Monaco multi-tab + live multi-user collab (document OT).
// Agent: FETCHES blobs; EDITS buffers; LIVE ops via useDocumentCollab; SAVE replaceTextFileContent.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  fetchFileBlobForPreview,
  fetchPublicShareBlobForPreview,
  getErrorMessage,
  getOrCreatePublicCollabGuestId,
  replacePublicShareFileContent,
  replaceTextFileContent,
} from "@/api/client";
import { ConfirmDiscardDialog } from "@/components/drive/ConfirmDiscardDialog";
import { RtfCollabPresence } from "@/components/drive/rtf/RtfCollabPresence";
import { CodeEditorHeader } from "@/components/drive/text-code-editor/CodeEditorHeader";
import { CodeEditorStatusBar } from "@/components/drive/text-code-editor/CodeEditorStatusBar";
import {
  CodeEditorSurface,
  type CodeEditorCursorState,
  type CodeEditorSurfaceHandle,
} from "@/components/drive/text-code-editor/CodeEditorSurface";
import { EditorSettingsPanel } from "@/components/drive/text-code-editor/EditorSettingsPanel";
import { EditorThemeProvider } from "@/components/drive/text-code-editor/EditorThemeProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentCollab } from "@/hooks/useDocumentCollab";
import { applyTextReplace } from "@/lib/text-code-editor/collab-monaco";
import { detectEditorLanguage } from "@/lib/text-code-editor/language";
import { configureLocalMonaco } from "@/lib/text-code-editor/monaco-setup";
import {
  readEditorPreferences,
  writeEditorPreferences,
  type EditorPreferences,
} from "@/lib/text-code-editor/preferences";
import {
  getEditorTheme,
  readEditorThemePreference,
  resolveEditorThemeId,
  writeEditorThemePreference,
  type EditorThemePreference,
} from "@/lib/text-code-editor/theme";
import { cn } from "@/lib/utils";

// Human: Ensure Monaco workers and API resolve from the local package inside this code-split chunk.
configureLocalMonaco();

export type TextCodeEditorDialogProps = {
  tabs: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (file: FileItem) => void;
  onFileSaved?: (previousId: string, file: FileItem) => void;
  /** Human: Parent folder label shown in the status bar as the git-branch analogue. */
  branchLabel?: string;
  /** When set, bytes load through anonymous public share download. */
  shareToken?: string;
  sharePassword?: string | null;
  /**
   * Human: When false, force view-only (public link without allow_edit).
   * Agent: DEFAULT true for owned Drive opens; false for anonymous public share tokens.
   */
  canEdit?: boolean;
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

function detectEol(text: string): "LF" | "CRLF" | "CR" {
  if (text.includes("\r\n")) return "CRLF";
  if (text.includes("\r")) return "CR";
  return "LF";
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
  canEdit,
}: TextCodeEditorDialogProps) {
  // Human: Public share tokens are view-only unless canEdit is explicitly true (allow_edit).
  // Agent: readOnly when canEdit===false OR (shareToken without canEdit).
  const readOnly = canEdit === false || (Boolean(shareToken) && canEdit !== true);
  const { user } = useAuth();
  const [openTabs, setOpenTabs] = useState<FileItem[]>(tabs);
  const [buffers, setBuffers] = useState<Record<string, EditorBuffer>>({});
  const [preferences, setPreferences] = useState<EditorPreferences>(() => readEditorPreferences());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cursor, setCursor] = useState<CodeEditorCursorState>({
    lineNumber: 1,
    column: 1,
    selectedChars: 0,
    selectedLines: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  /** Human: Which close the discard prompt is guarding — the whole editor, or one tab. */
  const [pendingDiscard, setPendingDiscard] = useState<
    { kind: "editor" } | { kind: "tab"; file: FileItem } | null
  >(null);
  const [themePreference, setThemePreference] = useState<EditorThemePreference>(() =>
    readEditorThemePreference(),
  );
  const activeFileIdRef = useRef<string | null>(null);
  const surfaceRef = useRef<CodeEditorSurfaceHandle>(null);
  const applyingRemoteRef = useRef(false);
  const activeValueRef = useRef("");
  const publicGuestIdRef = useRef<string | null>(null);
  if (shareToken && !publicGuestIdRef.current) {
    publicGuestIdRef.current = getOrCreatePublicCollabGuestId();
  }
  const resolvedThemeId = resolveEditorThemeId(themePreference);
  const resolvedTheme = getEditorTheme(resolvedThemeId);

  useEffect(() => {
    if (!open) return;
    setOpenTabs(tabs);
  }, [open, tabs]);

  const activeFile = file;
  const activeBuffer = activeFile ? (buffers[activeFile.id] ?? emptyBuffer()) : emptyBuffer();
  activeValueRef.current = activeBuffer.value;
  const activeLanguage = activeFile
    ? detectEditorLanguage(activeFile.name, activeFile.mime_type)
    : detectEditorLanguage("untitled.txt", "text/plain");

  const bufferReady =
    Boolean(activeFile?.id) &&
    Boolean(buffers[activeFile!.id]) &&
    !activeBuffer.loading &&
    !activeBuffer.error;

  // Human: Live collab for owned/user-share (JWT) and public allow_edit links (guest API).
  // Agent: ENABLE when editable + active tab buffer ready; active tab only.
  const collabEnabled = open && !readOnly && bufferReady;

  const publicGuestId = publicGuestIdRef.current;
  const publicShareCollab =
    shareToken && publicGuestId
      ? {
          token: shareToken,
          sharePassword: sharePassword ?? null,
          guestId: publicGuestId,
        }
      : null;

  const localCollabUserId = publicShareCollab
    ? `guest:${publicShareCollab.guestId}`
    : (user?.id ?? null);
  const collabDisplayName = publicShareCollab
    ? user?.email
      ? `${user.email} (link)`
      : "Guest"
    : (user?.email ?? user?.id ?? "User");

  const collab = useDocumentCollab({
    fileId: activeFile?.id,
    enabled: collabEnabled,
    displayName: collabDisplayName,
    localUserId: localCollabUserId,
    publicShare: publicShareCollab,
    getSeed: () => ({
      html: "",
      text: activeValueRef.current,
    }),
    onRemoteText: (text, fromUserId) => {
      if (localCollabUserId && fromUserId === localCollabUserId) return;
      if (user?.id && fromUserId === user.id) return;
      if (!activeFile) return;
      if (text === activeValueRef.current) return;
      applyingRemoteRef.current = true;
      try {
        surfaceRef.current?.setValueFromRemote(text);
        activeValueRef.current = text;
        setBuffers((current) => ({
          ...current,
          [activeFile.id]: {
            ...(current[activeFile.id] ?? emptyBuffer()),
            value: text,
          },
        }));
      } finally {
        applyingRemoteRef.current = false;
      }
    },
    onRemoteTextOp: (op) => {
      if (localCollabUserId && op.fromUserId === localCollabUserId) return;
      if (user?.id && op.fromUserId === user.id) return;
      if (!activeFile) return;
      applyingRemoteRef.current = true;
      try {
        const next =
          surfaceRef.current?.applyRemoteReplace({
            index: op.index,
            delete: op.delete,
            insert: op.insert,
          }) ??
          applyTextReplace(activeValueRef.current, {
            index: op.index,
            delete: op.delete,
            insert: op.insert,
          });
        if (next == null) return;
        activeValueRef.current = next;
        setBuffers((current) => ({
          ...current,
          [activeFile.id]: {
            ...(current[activeFile.id] ?? emptyBuffer()),
            value: next,
          },
        }));
      } finally {
        applyingRemoteRef.current = false;
      }
    },
  });

  // Human: Paint remote carets/selections from presence (Google Docs–style).
  useEffect(() => {
    if (!collabEnabled) {
      surfaceRef.current?.setRemotePresence([]);
      return;
    }
    const ranges = collab.participants
      .filter((p) => p.user_id !== localCollabUserId)
      .map((p) => {
        const start = p.selection_start ?? 0;
        const end = p.selection_end ?? start;
        return {
          userId: p.user_id,
          color: p.color || "#2563EB",
          start,
          end,
          label: p.display_name,
        };
      });
    surfaceRef.current?.setRemotePresence(ranges);
  }, [collab.participants, collabEnabled, localCollabUserId]);

  const dirty = activeBuffer.value !== activeBuffer.savedValue;
  const dirtyTabIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, buffer] of Object.entries(buffers)) {
      if (buffer.value !== buffer.savedValue) ids.add(id);
    }
    return ids;
  }, [buffers]);

  const syncLabel = saveError
    ? saveError
    : saving
      ? "Saving to cloud…"
      : readOnly
        ? "Read-only share"
        : dirty
          ? "Unsaved changes"
          : "Saved to cloud";

  const syncTone = saveError
    ? "error"
    : saving
      ? "saving"
      : dirty
        ? "dirty"
        : "saved";

  const cursorLabel = `Ln ${cursor.lineNumber}, Col ${cursor.column}`;
  const selectionLabel =
    cursor.selectedChars > 0
      ? cursor.selectedLines > 1
        ? `${cursor.selectedChars} chars, ${cursor.selectedLines} lines`
        : `${cursor.selectedChars} selected`
      : null;
  const indentLabel = preferences.insertSpaces
    ? `Spaces: ${preferences.tabSize}`
    : `Tabs: ${preferences.tabSize}`;
  const eolLabel = detectEol(activeBuffer.value);

  const updatePreferences = useCallback((next: EditorPreferences) => {
    setPreferences(next);
    writeEditorPreferences(next);
  }, []);

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

  // Human: Fetch each tab's bytes once when first activated — empty files are valid and must not re-fetch forever.
  // Agent: SKIPS when buffers already has an entry (loading, loaded, or error); CALLS loadFileContent otherwise.
  useEffect(() => {
    if (!open || !activeFile) return;
    if (buffers[activeFile.id]) return;
    void loadFileContent(activeFile);
  }, [activeFile, buffers, loadFileContent, open]);

  useEffect(() => {
    if (!open) return;
    setSettingsOpen(false);
    setSaveError("");
  }, [activeFile?.id, open]);

  // Human: Close for real — used directly when nothing is dirty, and after the discard prompt.
  const closeEditor = useCallback(() => {
    setBuffers({});
    onOpenChange(false);
  }, [onOpenChange]);

  const handleCloseRequest = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      const anyDirty = Object.values(buffers).some((buffer) => buffer.value !== buffer.savedValue);
      if (anyDirty && !readOnly) {
        setPendingDiscard({ kind: "editor" });
        return;
      }
      closeEditor();
    },
    [buffers, closeEditor, onOpenChange, readOnly],
  );

  const handleSelectTab = useCallback(
    (nextFile: FileItem) => {
      if (nextFile.id === activeFile?.id) return;
      onFileChange(nextFile);
    },
    [activeFile?.id, onFileChange],
  );

  // Human: Drop one tab — used directly when it is clean, and after the discard prompt.
  const closeTab = useCallback(
    (closing: FileItem) => {
      const remaining = openTabs.filter((tab) => tab.id !== closing.id);
      setOpenTabs(remaining);
      setBuffers((current) => {
        const next = { ...current };
        delete next[closing.id];
        return next;
      });

      if (closing.id === activeFile?.id) {
        if (remaining.length > 0) {
          onFileChange(remaining[0]!);
        } else {
          onOpenChange(false);
        }
      }
    },
    [activeFile?.id, onFileChange, onOpenChange, openTabs],
  );

  const handleCloseTab = useCallback(
    (closing: FileItem) => {
      const closingBuffer = buffers[closing.id] ?? emptyBuffer();
      const closingDirty = closingBuffer.value !== closingBuffer.savedValue;
      if (closingDirty && !readOnly) {
        setPendingDiscard({ kind: "tab", file: closing });
        return;
      }
      closeTab(closing);
    },
    [buffers, closeTab, readOnly],
  );

  // Human: Run whichever close the discard prompt was guarding, then dismiss the prompt.
  const handleConfirmDiscard = useCallback(() => {
    const pending = pendingDiscard;
    setPendingDiscard(null);
    if (!pending) return;
    if (pending.kind === "editor") closeEditor();
    else closeTab(pending.file);
  }, [closeEditor, closeTab, pendingDiscard]);

  const handleValueChange = useCallback(
    (nextValue: string) => {
      if (!activeFile || readOnly) return;
      const before = activeValueRef.current;
      activeValueRef.current = nextValue;
      setSaveError("");
      setBuffers((current) => ({
        ...current,
        [activeFile.id]: {
          ...(current[activeFile.id] ?? emptyBuffer()),
          value: nextValue,
        },
      }));
      if (!applyingRemoteRef.current && before !== nextValue) {
        collab.publishPlainChange(before, nextValue);
      }
    },
    [activeFile, collab, readOnly],
  );

  const handleCollabSelectionChange = useCallback(
    (start: number, end: number) => {
      if (!collabEnabled) return;
      void collab.updatePresence({
        selection_start: start,
        selection_end: end,
      });
    },
    [collab, collabEnabled],
  );

  const handleSave = useCallback(async () => {
    if (!activeFile || readOnly || saving || !dirty) return;
    setSaving(true);
    setSaveError("");
    try {
      const { file: savedFile } = shareToken
        ? await replacePublicShareFileContent(
            shareToken,
            activeFile,
            activeBuffer.value,
            sharePassword,
          )
        : await replaceTextFileContent(activeFile, activeBuffer.value);
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
  }, [
    activeBuffer.value,
    activeFile,
    dirty,
    onFileChange,
    onFileSaved,
    readOnly,
    saving,
    sharePassword,
    shareToken,
  ]);

  const handleDownload = useCallback(() => {
    if (!activeFile) return;
    const blob = new Blob([activeBuffer.value], {
      type: activeFile.mime_type || "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeFile.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [activeBuffer.value, activeFile]);

  const handleThemePreferenceChange = useCallback((preference: EditorThemePreference) => {
    setThemePreference(preference);
    writeEditorThemePreference(preference);
  }, []);

  // Human: Global shortcuts that should work even when Monaco focus is elsewhere in the dialog.
  // Agent: LISTENS keydown while open; ROUTES save/settings; Monaco owns find/replace/goto.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;

      if (mod && key === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }

      if (mod && key === "," && !event.shiftKey) {
        event.preventDefault();
        setSettingsOpen((current) => !current);
        return;
      }

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleSave, open, settingsOpen]);

  return (
    <Dialog open={open} onOpenChange={handleCloseRequest}>
      <DialogContent
        // Human: Match PDF viewer shell — full viewport dialog with Safari-safe height tokens.
        // Agent: max-h/h use min(1275px,_calc(100svh-2rem),_calc(100dvh-2rem)); NEVER bare commas inside arbitrary values.
        className="flex h-[min(1275px,_calc(100svh-2rem),_calc(100dvh-2rem))] max-h-[min(1275px,_calc(100svh-2rem),_calc(100dvh-2rem))] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden border-0 bg-transparent p-2 shadow-none ring-0 sm:max-w-[min(112.5rem,_calc(100%-2rem))] sm:p-4"
        overlayClassName={resolvedTheme.overlay}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{activeFile?.name ?? "Text editor"}</DialogTitle>
          <DialogDescription>
            Edit text and source files with a full code editor: syntax highlighting, search,
            multi-cursor, minimap, and cloud save.
          </DialogDescription>
        </DialogHeader>

        <EditorThemeProvider preference={themePreference}>
          <div
            className={cn(
              "relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden",
              resolvedTheme.shell,
            )}
          >
            <CodeEditorHeader
              tabs={openTabs}
              activeFileId={activeFile?.id ?? null}
              dirtyTabIds={dirtyTabIds}
              wordWrap={preferences.wordWrap}
              minimap={preferences.minimap}
              settingsOpen={settingsOpen}
              readOnly={readOnly}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onToggleWordWrap={() =>
                updatePreferences({ ...preferences, wordWrap: !preferences.wordWrap })
              }
              onToggleMinimap={() =>
                updatePreferences({ ...preferences, minimap: !preferences.minimap })
              }
              onToggleSettings={() => setSettingsOpen((current) => !current)}
              onFind={() => surfaceRef.current?.triggerFind()}
              onReplace={() => surfaceRef.current?.triggerReplace()}
              onGoToLine={() => surfaceRef.current?.triggerGoToLine()}
              onFormat={() => void surfaceRef.current?.triggerFormatDocument()}
              onCommandPalette={() => surfaceRef.current?.triggerCommandPalette()}
            />

            <EditorSettingsPanel
              open={settingsOpen}
              preferences={preferences}
              themePreference={themePreference}
              onPreferencesChange={updatePreferences}
              onThemePreferenceChange={handleThemePreferenceChange}
            />

            {collabEnabled ? (
              <RtfCollabPresence
                participants={collab.participants}
                currentUserId={localCollabUserId}
                error={collab.error}
                transport={collab.transport}
                statusHint="Live co-editing"
              />
            ) : null}

            <div className="relative flex min-h-0 flex-1 flex-col">
              {activeBuffer.loading ? (
                <div
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 text-sm",
                    resolvedTheme.loadingText,
                  )}
                >
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  Loading file…
                </div>
              ) : null}

              {activeBuffer.error ? (
                <p
                  className="flex flex-1 items-center justify-center px-6 text-center text-sm text-danger"
                  role="alert"
                >
                  {activeBuffer.error}
                </p>
              ) : null}

              {!activeBuffer.loading && !activeBuffer.error && activeFile ? (
                <CodeEditorSurface
                  key={activeFile.id}
                  ref={surfaceRef}
                  filename={activeFile.name}
                  mimeType={activeFile.mime_type}
                  value={activeBuffer.value}
                  readOnly={readOnly}
                  preferences={preferences}
                  onChange={handleValueChange}
                  onCursorChange={setCursor}
                  onCollabSelectionChange={handleCollabSelectionChange}
                  onSaveRequest={() => void handleSave()}
                />
              ) : null}
            </div>

            <CodeEditorStatusBar
              branchLabel={branchLabel}
              syncLabel={syncLabel}
              syncTone={syncTone}
              cursorLabel={cursorLabel}
              selectionLabel={selectionLabel}
              languageLabel={activeLanguage.label}
              indentLabel={indentLabel}
              encodingLabel="UTF-8"
              eolLabel={eolLabel}
              readOnly={readOnly}
              saving={saving}
              canSave={dirty && !activeBuffer.loading && !activeBuffer.error}
              onClose={() => handleCloseRequest(false)}
              onSave={() => void handleSave()}
              onDownload={activeFile ? handleDownload : undefined}
            />
          </div>
        </EditorThemeProvider>
      </DialogContent>
      <ConfirmDiscardDialog
        open={pendingDiscard !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDiscard(null);
        }}
        name={pendingDiscard?.kind === "tab" ? pendingDiscard.file.name : undefined}
        onConfirm={handleConfirmDiscard}
      />
    </Dialog>
  );
}
