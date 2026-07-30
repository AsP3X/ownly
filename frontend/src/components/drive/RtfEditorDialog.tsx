// Human: Full-viewport RTF rich-text editor — WYSIWYG + live multi-user collab with sentence locks.
// Agent: FETCHES blob; CONVERTS rtf↔html; LIVE ops via useDocumentCollab; SAVE replaceTextFileContent.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CloudLightning,
  FileText,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  fetchFileBlobForPreview,
  fetchPublicShareBlobForPreview,
  getErrorMessage,
  getOrCreatePublicCollabGuestId,
  replacePublicShareFileContent,
  replaceTextFileContent,
} from "@/api/client";
import {
  isEffectivelyEmptyHtml,
  RtfEditorSurface,
  type RtfEditorSurfaceHandle,
} from "@/components/drive/rtf/RtfEditorSurface";
import { RtfCollabPresence } from "@/components/drive/rtf/RtfCollabPresence";
import { RtfEditorToolbar } from "@/components/drive/rtf/RtfEditorToolbar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentCollab } from "@/hooks/useDocumentCollab";
import { getSelectionPlainOffsets, isTextMutatingKey } from "@/lib/rtf/dom-text-offset";
import { rootPlainText } from "@/lib/rtf/plain-offset-range";
import {
  applyPlainReplaceToEditor,
  diffPlainText,
  transformRangeThroughReplace,
} from "@/lib/rtf/text-ops";
import { htmlToRtf } from "@/lib/rtf/html-to-rtf";
import { rtfToHtml } from "@/lib/rtf/rtf-to-html";
import { htmlToPlainText } from "@/lib/rtf/sentence-range";
import { cn } from "@/lib/utils";

export type RtfEditorDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSaved?: (previousId: string, file: FileItem) => void;
  shareToken?: string;
  sharePassword?: string | null;
  /**
   * Human: When false, force view-only (e.g. public link or shared-with-me view grant).
   * Agent: DEFAULT true for owned Drive opens; false for anonymous public share tokens.
   */
  canEdit?: boolean;
};

export function RtfEditorDialog({
  file,
  open,
  onOpenChange,
  onFileSaved,
  shareToken,
  sharePassword,
  canEdit,
}: RtfEditorDialogProps) {
  // Human: Public share tokens are view-only unless canEdit is explicitly true (allow_edit or user share write).
  // Agent: readOnly when canEdit===false OR (shareToken without canEdit).
  const readOnly = canEdit === false || (Boolean(shareToken) && canEdit !== true);
  const { user } = useAuth();
  const surfaceRef = useRef<RtfEditorSurfaceHandle>(null);
  const activeFileIdRef = useRef<string | null>(null);
  /** Human: After save, parent swaps file id — do not refetch and remount the document. */
  const suppressLoadForFileIdsRef = useRef<Set<string>>(new Set());
  const loadedFileIdRef = useRef<string | null>(null);
  const applyingRemoteRef = useRef(false);
  const lastLocalEditAtRef = useRef(0);
  const draftHtmlRef = useRef("<p><br></p>");
  /** Human: Last plain text snapshot for concurrent text-op diffs. */
  const lastPlainRef = useRef("");
  const fullSyncTimerRef = useRef<number | null>(null);
  /** Human: Stable guest id for public-share collab participant key (guest:uuid). */
  const publicGuestIdRef = useRef<string | null>(null);
  if (shareToken && !publicGuestIdRef.current) {
    publicGuestIdRef.current = getOrCreatePublicCollabGuestId();
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Human: Seed HTML for the uncontrolled surface — only changes on load, not while typing. */
  const [documentKey, setDocumentKey] = useState("");
  const [seedHtml, setSeedHtml] = useState("<p><br></p>");
  const [savedHtml, setSavedHtml] = useState("<p><br></p>");
  const [draftHtml, setDraftHtml] = useState("<p><br></p>");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  /** Human: Bumps after remote HTML apply so lock marks re-wrap onto the new DOM. */
  const [collabLayoutTick, setCollabLayoutTick] = useState(0);

  draftHtmlRef.current = draftHtml;
  const dirty = draftHtml !== savedHtml;

  // Human: Live collab for owned/user-share (JWT) and public allow_edit links (guest API).
  // Agent: ENABLE when editable; publicShare routes join/ops/heartbeat/WS via share token.
  const collabEnabled =
    open && !readOnly && Boolean(file?.id) && !loading && Boolean(documentKey);

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

  const localLockRef = useRef<{ start: number; end: number } | null>(null);

  const collab = useDocumentCollab({
    fileId: file?.id,
    enabled: collabEnabled,
    displayName: collabDisplayName,
    localUserId: localCollabUserId,
    publicShare: publicShareCollab,
    getSeed: () => ({
      html: draftHtmlRef.current,
      text: lastPlainRef.current || htmlToPlainText(draftHtmlRef.current),
    }),
    onRemoteDocument: (html, text, fromUserId) => {
      if (localCollabUserId && fromUserId === localCollabUserId) return;
      if (user?.id && fromUserId === user.id) return;
      if (html === draftHtmlRef.current) return;
      // Human: format_commit only lands when server text matches — safe to apply HTML.
      applyingRemoteRef.current = true;
      try {
        surfaceRef.current?.setHtml(html);
        setDraftHtml(html);
        draftHtmlRef.current = html;
        const el = surfaceRef.current?.getEditorElement();
        lastPlainRef.current = el ? rootPlainText(el) : text || htmlToPlainText(html);
        setCollabLayoutTick((tick) => tick + 1);
      } finally {
        applyingRemoteRef.current = false;
      }
    },
    onRemoteTextOp: (op) => {
      if (localCollabUserId && op.fromUserId === localCollabUserId) return;
      if (user?.id && op.fromUserId === user.id) return;
      const root = surfaceRef.current?.getEditorElement();
      if (!root) return;
      applyingRemoteRef.current = true;
      try {
        const replace = {
          index: op.index,
          deleteCount: op.delete,
          insertText: op.insert,
        };
        const nextPlain = applyPlainReplaceToEditor(root, replace);
        lastPlainRef.current = nextPlain;
        if (localLockRef.current) {
          const shifted = transformRangeThroughReplace(
            localLockRef.current.start,
            localLockRef.current.end,
            replace,
          );
          localLockRef.current = shifted;
        }
        const nextHtml = surfaceRef.current?.getHtml() ?? draftHtmlRef.current;
        setDraftHtml(nextHtml);
        draftHtmlRef.current = nextHtml;
        setCollabLayoutTick((tick) => tick + 1);
      } finally {
        applyingRemoteRef.current = false;
      }
    },
  });

  // Keep local lock range for merge-on-full-sync
  useEffect(() => {
    const me = collab.participants.find((p) => p.user_id === localCollabUserId);
    if (
      me?.lock_start != null &&
      me.lock_end != null &&
      me.lock_end > me.lock_start
    ) {
      localLockRef.current = { start: me.lock_start, end: me.lock_end };
    }
  }, [collab.participants, localCollabUserId]);

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

  const applyLoadedDocument = useCallback((fileId: string, nextHtml: string) => {
    const html = nextHtml?.trim() ? nextHtml : "<p><br></p>";
    loadedFileIdRef.current = fileId;
    setSeedHtml(html);
    setSavedHtml(html);
    setDraftHtml(html);
    draftHtmlRef.current = html;
    // Human: Seed plain baseline so the first keystroke does not republish the whole document.
    lastPlainRef.current = htmlToPlainText(html);
    localLockRef.current = null;
    setDocumentKey(`${fileId}:${Date.now()}`);
  }, []);

  const loadFile = useCallback(
    async (target: FileItem) => {
      activeFileIdRef.current = target.id;
      setLoading(true);
      setError("");
      setSaveError("");
      try {
        const blob = shareToken
          ? await fetchPublicShareBlobForPreview(shareToken, target.id, sharePassword)
          : await fetchFileBlobForPreview(target);
        if (activeFileIdRef.current !== target.id) return;
        const text = await blob.text();
        applyLoadedDocument(target.id, rtfToHtml(text));
      } catch (err) {
        if (activeFileIdRef.current !== target.id) return;
        setError(getErrorMessage(err));
        applyLoadedDocument(target.id, "<p><br></p>");
      } finally {
        if (activeFileIdRef.current === target.id) setLoading(false);
      }
    },
    [applyLoadedDocument, sharePassword, shareToken],
  );

  useEffect(() => {
    if (!open || !file) return;

    if (suppressLoadForFileIdsRef.current.has(file.id)) {
      suppressLoadForFileIdsRef.current.delete(file.id);
      activeFileIdRef.current = file.id;
      loadedFileIdRef.current = file.id;
      return;
    }

    if (loadedFileIdRef.current === file.id) {
      activeFileIdRef.current = file.id;
      return;
    }

    void loadFile(file);
  }, [file, loadFile, open]);

  useEffect(() => {
    if (!open) {
      setSeedHtml("<p><br></p>");
      setSavedHtml("<p><br></p>");
      setDraftHtml("<p><br></p>");
      draftHtmlRef.current = "<p><br></p>";
      lastPlainRef.current = "";
      localLockRef.current = null;
      if (fullSyncTimerRef.current !== null) {
        window.clearTimeout(fullSyncTimerRef.current);
        fullSyncTimerRef.current = null;
      }
      setDocumentKey("");
      setError("");
      setSaveError("");
      setLoading(false);
      loadedFileIdRef.current = null;
      suppressLoadForFileIdsRef.current.clear();
    }
  }, [open]);

  // Human: After the surface mounts the seed HTML, re-baseline plain text from the live DOM
  // (rootPlainText coordinate system used by locks + concurrent ops).
  useEffect(() => {
    if (!open || !documentKey || loading) return;
    const frame = window.requestAnimationFrame(() => {
      const root = surfaceRef.current?.getEditorElement();
      if (!root) return;
      lastPlainRef.current = rootPlainText(root);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [documentKey, loading, open]);

  // Human: Never leave a pending full-doc publish timer after unmount.
  useEffect(() => {
    return () => {
      if (fullSyncTimerRef.current !== null) {
        window.clearTimeout(fullSyncTimerRef.current);
        fullSyncTimerRef.current = null;
      }
    };
  }, []);

  const handleLocalChange = useCallback(
    (html: string) => {
      if (applyingRemoteRef.current) return;
      lastLocalEditAtRef.current = Date.now();
      setDraftHtml(html);
      draftHtmlRef.current = html;

      const root = surfaceRef.current?.getEditorElement();
      const nextPlain = root ? rootPlainText(root) : htmlToPlainText(html);
      const prevPlain = lastPlainRef.current;
      const diff = diffPlainText(prevPlain, nextPlain);
      lastPlainRef.current = nextPlain;

      // Human: Single OT replace op (server-authoritative).
      if (diff) {
        collab.publishTextOp({
          index: diff.index,
          delete: diff.deleteCount,
          insert: diff.insertText,
        });
      }

      // Human: format_commit only when plain text is stable (server rejects text_mismatch).
      if (fullSyncTimerRef.current !== null) {
        window.clearTimeout(fullSyncTimerRef.current);
      }
      fullSyncTimerRef.current = window.setTimeout(() => {
        fullSyncTimerRef.current = null;
        collab.publishDocument(draftHtmlRef.current, lastPlainRef.current);
      }, 600);
    },
    [collab],
  );

  // Human: Protect foreign locked sentences — block typing/deletes inside another user's lock.
  // Agent: CAPTURE keydown; debounced selection → sentence lock; READS isRangeLockedByOther.
  useEffect(() => {
    if (!collabEnabled) return;
    let lockTimer: number | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTextMutatingKey(event)) return;
      const root = surfaceRef.current?.getEditorElement();
      if (!root) return;
      const offsets = getSelectionPlainOffsets(root);
      if (!offsets) return;
      const probeEnd = Math.max(offsets.end, offsets.start + 1);
      if (collab.isRangeLockedByOther(offsets.start, probeEnd)) {
        event.preventDefault();
        event.stopPropagation();
        setSaveError("That sentence is locked by another collaborator.");
        window.setTimeout(() => setSaveError(""), 2500);
      }
    };

    const onSelectionChange = () => {
      const root = surfaceRef.current?.getEditorElement();
      if (!root) return;
      const offsets = getSelectionPlainOffsets(root);
      if (!offsets) return;
      if (lockTimer !== null) window.clearTimeout(lockTimer);
      // Human: Broadcast caret on the next frame for live peer carets.
      lockTimer = window.setTimeout(() => {
        const text = rootPlainText(root);
        void collab.acquireSentenceLock(text, offsets.start, offsets.end);
      }, 0);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      if (lockTimer !== null) window.clearTimeout(lockTimer);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown, true);
      void collab.releaseLock();
    };
  }, [collab, collabEnabled]);

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
      void collab.releaseLock();
      onOpenChange(false);
    },
    [collab, dirty, onOpenChange, readOnly],
  );

  const handleSave = useCallback(async () => {
    if (!file || readOnly || saving || !dirty) return;
    setSaving(true);
    setSaveError("");
    try {
      const currentHtml = surfaceRef.current?.getHtml() ?? draftHtml;

      if (isEffectivelyEmptyHtml(currentHtml) && !isEffectivelyEmptyHtml(savedHtml)) {
        setSaveError(
          "Save blocked: the editor looks empty. Click in the document and try again.",
        );
        return;
      }

      const rtf = htmlToRtf(currentHtml);
      if (!rtf.includes("\\rtf") || rtf.length < 20) {
        setSaveError("Could not build a valid RTF document from the editor content.");
        return;
      }

      const roundTripHtml = rtfToHtml(rtf);
      if (
        !isEffectivelyEmptyHtml(currentHtml) &&
        isEffectivelyEmptyHtml(roundTripHtml)
      ) {
        setSaveError(
          "Save blocked: the RTF converter dropped the document text. Your file was not changed.",
        );
        return;
      }

      const { file: savedFile } = shareToken
        ? await replacePublicShareFileContent(shareToken, file, rtf, sharePassword)
        : await replaceTextFileContent(file, rtf);

      setDraftHtml(currentHtml);
      setSavedHtml(currentHtml);
      draftHtmlRef.current = currentHtml;
      const root = surfaceRef.current?.getEditorElement();
      const plain = root ? rootPlainText(root) : htmlToPlainText(currentHtml);
      lastPlainRef.current = plain;
      loadedFileIdRef.current = savedFile.id;
      suppressLoadForFileIdsRef.current.add(savedFile.id);
      onFileSaved?.(file.id, savedFile);
      // Keep collab session peers in sync with the durable save snapshot
      collab.publishDocument(currentHtml, plain);
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [
    collab,
    dirty,
    draftHtml,
    file,
    onFileSaved,
    readOnly,
    savedHtml,
    saving,
    sharePassword,
    shareToken,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleSave, open]);

  return (
    <Dialog open={open} onOpenChange={handleCloseRequest}>
      <DialogContent
        // Human: Match PDF / text editor shell — full viewport Safari-safe dialog.
        className="flex h-[min(1275px,_calc(100svh-2rem),_calc(100dvh-2rem))] max-h-[min(1275px,_calc(100svh-2rem),_calc(100dvh-2rem))] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden border-0 bg-transparent p-2 shadow-none ring-0 sm:max-w-[min(112.5rem,_calc(100%-2rem))] sm:p-4"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "Rich text editor"}</DialogTitle>
          <DialogDescription>
            Edit rich text documents with live collaboration. Changes save as RTF.
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.2)]">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-edge px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="size-5 shrink-0 text-brand" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">
                  {file?.name ?? "Rich text"}
                </p>
                <p className="text-[11px] text-ink-faint">
                  Rich Text Document · RTF
                  {collabEnabled ? " · Live co-edit" : ""}
                </p>
              </div>
              {readOnly ? (
                <span className="hidden items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 sm:inline-flex">
                  <ShieldCheck className="size-3" aria-hidden />
                  Read-only
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => handleCloseRequest(false)}
              aria-label="Close editor"
              className="inline-flex size-8 items-center justify-center rounded-lg text-[#666] transition-colors hover:bg-black/5"
            >
              <X className="size-4" />
            </button>
          </header>

          <RtfEditorToolbar
            disabled={loading || Boolean(error) || readOnly || !documentKey}
            onCommand={(command, value) => surfaceRef.current?.exec(command, value)}
          />

          {collabEnabled ? (
            <RtfCollabPresence
              participants={collab.participants}
              currentUserId={localCollabUserId}
              error={collab.error}
              transport={collab.transport}
            />
          ) : null}

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {loading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#666]">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                Loading document…
              </div>
            ) : null}

            {error ? (
              <p
                className="flex flex-1 items-center justify-center px-6 text-center text-sm text-danger"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {!loading && !error && documentKey ? (
              <RtfEditorSurface
                ref={surfaceRef}
                documentKey={documentKey}
                initialHtml={seedHtml}
                readOnly={readOnly}
                onChange={handleLocalChange}
                className="min-h-0 flex-1"
                collabParticipants={collabEnabled ? collab.participants : undefined}
                collabCurrentUserId={localCollabUserId}
                collabLayoutKey={
                  collabEnabled
                    ? `${collabLayoutTick}:${collab.participants
                        .map(
                          (p) =>
                            `${p.user_id}:${p.lock_start ?? ""}:${p.lock_end ?? ""}`,
                        )
                        .join("|")}`
                    : undefined
                }
              />
            ) : null}
          </div>

          <footer className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-edge bg-surface px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <CloudLightning
                className={cn(
                  "size-3.5 shrink-0",
                  syncTone === "saved" && "text-ok",
                  syncTone === "dirty" && "text-warn",
                  syncTone === "saving" && "text-brand",
                  syncTone === "error" && "text-danger",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "truncate text-xs",
                  syncTone === "saved" && "text-ok",
                  syncTone === "dirty" && "text-warn",
                  syncTone === "saving" && "text-brand",
                  syncTone === "error" && "text-danger",
                )}
              >
                {syncLabel}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => handleCloseRequest(false)}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-[#666] transition-colors hover:bg-black/5"
              >
                Close
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving || loading || Boolean(error)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                  Save
                </button>
              ) : null}
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
