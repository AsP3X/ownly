// Human: Modal thumbnail chooser opened from file details — pick among auto-generated poster frames.
// Agent: WRAPS VideoThumbnailPicker; PATCHES selectFileThumbnail via picker; CALLS onSelected on save.

import type { FileItem } from "@/api/client";
import { VideoThumbnailPicker } from "@/components/drive/VideoThumbnailPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type VideoThumbnailEditorDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelected?: (file: FileItem, selectedIndex: number) => void;
  /** Human: Notifies parent when thumbnail job status changes after regenerate. */
  onFileUpdated?: (file: FileItem) => void;
};

/** Human: Full-screen-ish editor for choosing the drive grid poster on a video file. */
export function VideoThumbnailEditorDialog({
  file,
  open,
  onOpenChange,
  onSelected,
  onFileUpdated,
}: VideoThumbnailEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,720px)] flex-col gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b border-neutral-100 px-6 py-5 pr-12">
          <DialogTitle className="text-lg text-neutral-900">Thumbnail</DialogTitle>
          <DialogDescription className="text-neutral-500">
            Choose the poster frame shown on this video in your library.
          </DialogDescription>
        </DialogHeader>

        {/* Human: Scrollable body — preview + option strip can exceed short viewports. */}
        {file ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <VideoThumbnailPicker
              variant="editor"
              file={file}
              onSelected={(selectedIndex) => onSelected?.(file, selectedIndex)}
              onFileUpdated={onFileUpdated}
            />
          </div>
        ) : null}

        <DialogFooter className="shrink-0 border-t border-neutral-100 bg-neutral-50/80 px-6 py-4">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
