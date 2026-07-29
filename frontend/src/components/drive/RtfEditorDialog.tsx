// Human: Full-viewport RTF rich-text editor — WYSIWYG formatting, not raw RTF source.
// Agent: FETCHES blob; CONVERTS rtf↔html; SAVE replaceTextFileContent with serialized RTF.

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
  replaceTextFileContent,
} from "@/api/client";
import {
  isEffectivelyEmptyHtml,
  RtfEditorSurface,
  type RtfEditorSurfaceHandle,
} from "@/components/drive/rtf/RtfEditorSurface";
import { RtfEditorToolbar } from "@/components/drive/rtf/RtfEditorToolbar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { htmlToRtf } from "@/lib/rtf/html-to-rtf";
import { rtfToHtml } from "@/lib/rtf/rtf-to-html";
import { cn } from "@/lib/utils";

export type RtfEditorDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSaved?: (previousId: string, file: FileItem) => void;
  shareToken?: string;
  sharePassword?: string | null;
};

export function RtfEditorDialog({
  file,
  open,
  onOpenChange,
  onFileSaved,
  shareToken,
  sharePassword,
}: RtfEditorDialogProps) {
  const readOnly = Boolean(shareToken);
  const surfaceRef = useRef<RtfEditorSurfaceHandle>(null);
  const activeFileIdRef = useRef<string | null>(null);
  /** Human: After save, parent swaps file id — do not refetch and remount the document. */
  const suppressLoadForFileIdsRef = useRef<Set<string>>(new Set());
  const loadedFileIdRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Human: Seed HTML for the uncontrolled surface — only changes on load, not while typing. */
  const [documentKey, setDocumentKey] = useState("");
  const [seedHtml, setSeedHtml] = useState("<p><br></p>");
  const [savedHtml, setSavedHtml] = useState("<p><br></p>");
  const [draftHtml, setDraftHtml] = useState("<p><br></p>");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const dirty = draftHtml !== savedHtml;

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

    // Human: Save replaces the file id — keep the in-memory document instead of refetching.
    // Agent: SKIPS load when this id was just produced by a successful save.
    if (suppressLoadForFileIdsRef.current.has(file.id)) {
      suppressLoadForFileIdsRef.current.delete(file.id);
      activeFileIdRef.current = file.id;
      loadedFileIdRef.current = file.id;
      return;
    }

    // Human: Parent re-renders with a new FileItem object for the same id — do not re-seed the editor.
    // Agent: SKIPS when file.id already loaded for this dialog session.
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
      setDocumentKey("");
      setError("");
      setSaveError("");
      setLoading(false);
      loadedFileIdRef.current = null;
      suppressLoadForFileIdsRef.current.clear();
    }
  }, [open]);

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

  const handleSave = useCallback(async () => {
    if (!file || readOnly || saving || !dirty) return;
    setSaving(true);
    setSaveError("");
    try {
      // Human: Always read live DOM — draft state can lag a keystroke behind the surface.
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

      // Human: Sanity-check round-trip before deleting the server file.
      // Agent: PARSES generated RTF back to HTML; ABORTS when body text would be lost.
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

      const { file: savedFile } = await replaceTextFileContent(file, rtf);

      // Human: Keep the editor content in place — do not remount or reseed after save.
      setDraftHtml(currentHtml);
      setSavedHtml(currentHtml);
      loadedFileIdRef.current = savedFile.id;
      suppressLoadForFileIdsRef.current.add(savedFile.id);
      onFileSaved?.(file.id, savedFile);
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [dirty, draftHtml, file, onFileSaved, readOnly, savedHtml, saving]);

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
            Edit rich text documents with formatting. Changes save as RTF.
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="size-5 shrink-0 text-[#2563EB]" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#1A1A1A]">
                  {file?.name ?? "Rich text"}
                </p>
                <p className="text-[11px] text-[#888888]">Rich Text Document · RTF</p>
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

          {/* Human: Flex child consumes all remaining height under header/toolbar/footer. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {loading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#666]">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                Loading document…
              </div>
            ) : null}

            {error ? (
              <p
                className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#EF4444]"
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
                onChange={setDraftHtml}
                className="min-h-0 flex-1"
              />
            ) : null}
          </div>

          <footer className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-[#E5E7EB] bg-[#F7F8FA] px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <CloudLightning
                className={cn(
                  "size-3.5 shrink-0",
                  syncTone === "saved" && "text-[#10B981]",
                  syncTone === "dirty" && "text-[#F59E0B]",
                  syncTone === "saving" && "text-[#2563EB]",
                  syncTone === "error" && "text-[#EF4444]",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "truncate text-xs",
                  syncTone === "saved" && "text-[#10B981]",
                  syncTone === "dirty" && "text-[#F59E0B]",
                  syncTone === "saving" && "text-[#2563EB]",
                  syncTone === "error" && "text-[#EF4444]",
                )}
              >
                {syncLabel}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => handleCloseRequest(false)}
                className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#666] transition-colors hover:bg-black/5"
              >
                Close
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving || loading || Boolean(error)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
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
