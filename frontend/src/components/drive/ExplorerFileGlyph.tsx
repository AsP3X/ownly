// Human: Mime icon for explorer tiles and rows — neutral by default, tinted only by file family.
// Agent: SHARED by grid and list so a file type looks identical in both layouts.

import {
  FileArchive,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  ImageIcon,
  Music,
  Presentation,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Human: Per-family icon plus a restrained tint. Tints identify a file type at a glance;
 * they are deliberately desaturated so the brand accent still reads as "selected".
 * Agent: RETURNS a lucide component and its colour class for a given mime type.
 */
function resolveGlyph(mimeType: string | null | undefined): {
  Icon: typeof FileIcon;
  tone: string;
} {
  const mime = (mimeType ?? "").toLowerCase();

  if (mime.startsWith("image/")) return { Icon: ImageIcon, tone: "text-brand dark:text-brand" };
  if (mime.startsWith("video/")) return { Icon: Film, tone: "text-proc dark:text-violet-400" };
  if (mime.startsWith("audio/")) return { Icon: Music, tone: "text-teal-600 dark:text-teal-400" };
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) {
    return { Icon: FileSpreadsheet, tone: "text-ok dark:text-emerald-400" };
  }
  if (mime.includes("presentation") || mime.includes("powerpoint")) {
    return { Icon: Presentation, tone: "text-orange-600 dark:text-orange-400" };
  }
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("compressed")) {
    return { Icon: FileArchive, tone: "text-warn dark:text-warn" };
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("document") ||
    mime.includes("epub") ||
    mime.includes("rtf")
  ) {
    return { Icon: FileText, tone: "text-danger dark:text-rose-400" };
  }
  return { Icon: FileIcon, tone: "text-ink-faint" };
}

export type ExplorerFileGlyphProps = {
  mimeType: string | null | undefined;
  className?: string;
};

// Human: Render the icon for a file's type at whatever size the caller specifies.
// Agent: READS mime_type; className controls size (e.g. "size-8" for tiles, "size-4" for rows).
export function ExplorerFileGlyph({ mimeType, className }: ExplorerFileGlyphProps) {
  const { Icon, tone } = resolveGlyph(mimeType);
  return <Icon className={cn(tone, className)} aria-hidden />;
}
