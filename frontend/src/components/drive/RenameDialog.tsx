// Human: Modal for renaming a file or folder, replacing the browser's native prompt.
// Agent: CALLS renameFile/renameFolder; VALIDATES with validateResourceName before the request.

import { useEffect, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import { getErrorMessage, renameFile, renameFolder } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  splitRenameSelection,
  validateResourceName,
  type ResourceKind,
} from "@/lib/resource-name";

export type RenameTarget = {
  kind: ResourceKind;
  id: string;
  name: string;
};

type RenameDialogProps = {
  target: RenameTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Human: Names already in this folder, used to catch a collision before the request. */
  siblingNames?: readonly string[];
  onRenamed: (target: RenameTarget, nextName: string) => void;
};

// Human: Ask for the new name, validate it the way the API will, then rename in place.
// Agent: OWNS the request so failures stay inline; PARENT handles refresh + toast via onRenamed.
export function RenameDialog({
  target,
  onOpenChange,
  siblingNames = [],
  onRenamed,
}: RenameDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = target !== null;
  const kind = target?.kind ?? "file";
  const originalName = target?.name ?? "";
  const trimmed = name.trim();
  const unchanged = trimmed === originalName.trim();

  /**
   * Human: Seed the field with the current name and preselect only the stem, so typing a new
   * name never eats the extension.
   * Agent: RUNS on each open and target change; setSelectionRange needs the value committed first.
   */
  useEffect(() => {
    if (!target) return;
    setName(target.name);
    setError("");
    setSubmitting(false);

    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const { stem } = splitRenameSelection(target.name, target.kind);
      input.setSelectionRange(0, stem.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || submitting || unchanged) return;

    const validationError = validateResourceName({ name, kind: target.kind, siblingNames });
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      if (target.kind === "file") {
        await renameFile(target.id, trimmed);
      } else {
        await renameFolder(target.id, trimmed);
      }
      onRenamed(target, trimmed);
      onOpenChange(false);
    } catch (err) {
      // Human: A collision the sibling list could not see (another device, or a paged-out row).
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <DialogContent className="gap-0 overflow-hidden border-edge bg-panel p-0 sm:max-w-md">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader className="min-w-0 border-b border-hairline px-6 py-5 pr-12">
            <DialogTitle className="flex items-center gap-2 text-lg text-ink">
              <PencilLine className="size-5 shrink-0 text-brand" aria-hidden />
              {kind === "folder" ? "Rename folder" : "Rename file"}
            </DialogTitle>
            <DialogDescription className="break-words text-ink-muted">
              Renaming “{originalName}”.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 px-6 py-5">
            <Input
              ref={inputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError("");
              }}
              placeholder={kind === "folder" ? "Folder name" : "File name"}
              aria-label={kind === "folder" ? "Folder name" : "File name"}
              disabled={submitting}
            />
            {error ? (
              <Alert variant="destructive">
                <AlertDescription className="break-words">{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-hairline bg-surface/80">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-brand text-brand-on hover:bg-brand-hover"
              disabled={submitting || unchanged || trimmed.length === 0}
            >
              {submitting ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
