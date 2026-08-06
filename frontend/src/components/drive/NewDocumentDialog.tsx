// Human: Pick a document type to create in the current folder, then open it in its editor.
// Agent: PARENT builds and uploads the file; this dialog only chooses a template.

import { useEffect, useState } from "react";
import { FilePlus2, FileSpreadsheet, FileText, Loader2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  NEW_DOCUMENT_TEMPLATES,
  type NewDocumentKind,
  type NewDocumentTemplate,
} from "@/lib/new-document";
import { cn } from "@/lib/utils";

const TEMPLATE_ICONS: Record<NewDocumentKind, typeof FileText> = {
  text: Type,
  "rich-text": FileText,
  spreadsheet: FileSpreadsheet,
};

type NewDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human: Where the file will be created, shown so the destination is never a surprise. */
  destinationLabel: string;
  error?: string;
  creating?: boolean;
  onCreate: (template: NewDocumentTemplate) => void;
};

export function NewDocumentDialog({
  open,
  onOpenChange,
  destinationLabel,
  error = "",
  creating = false,
  onCreate,
}: NewDocumentDialogProps) {
  const [selected, setSelected] = useState<NewDocumentKind>("text");

  useEffect(() => {
    if (open) setSelected("text");
  }, [open]);

  const template =
    NEW_DOCUMENT_TEMPLATES.find((entry) => entry.kind === selected) ?? NEW_DOCUMENT_TEMPLATES[0]!;

  return (
    <Dialog open={open} onOpenChange={(next) => (creating ? undefined : onOpenChange(next))}>
      <DialogContent className="gap-0 overflow-hidden border-edge bg-panel p-0 sm:max-w-md">
        <DialogHeader className="border-b border-hairline px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2 text-lg text-ink">
            <FilePlus2 className="size-5 shrink-0 text-brand" aria-hidden />
            New document
          </DialogTitle>
          <DialogDescription className="break-words text-ink-muted">
            Creates an empty file in {destinationLabel} and opens it for editing.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex flex-col gap-2 px-6 py-5"
          role="radiogroup"
          aria-label="Document type"
        >
          {NEW_DOCUMENT_TEMPLATES.map((entry) => {
            const Icon = TEMPLATE_ICONS[entry.kind];
            const active = entry.kind === selected;
            return (
              <button
                key={entry.kind}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={creating}
                onClick={() => setSelected(entry.kind)}
                onDoubleClick={() => onCreate(entry)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
                  active
                    ? "border-brand/40 bg-brand-weak"
                    : "border-edge bg-panel hover:bg-surface",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-md",
                    active ? "bg-brand/12 text-brand" : "bg-surface text-ink-muted",
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{entry.label}</span>
                  <span className="block text-[11px] text-ink-faint">{entry.description}</span>
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
                  {entry.extension}
                </span>
              </button>
            );
          })}

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
            disabled={creating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-2 bg-brand text-brand-on hover:bg-brand-hover"
            disabled={creating}
            onClick={() => onCreate(template)}
          >
            {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
