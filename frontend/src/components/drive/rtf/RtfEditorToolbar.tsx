// Human: Formatting toolbar for the RTF rich-text editor — bold/italic/fonts/color/lists/align.
// Agent: EMITS document.execCommand actions against the active contenteditable surface.

import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type RtfEditorToolbarProps = {
  disabled?: boolean;
  onCommand: (command: string, value?: string) => void;
  className?: string;
};

const FONT_FAMILIES = [
  "Helvetica",
  "Arial",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Palatino Linotype",
  "Comic Sans MS",
];

const FONT_SIZES = [
  { label: "10", value: "1" },
  { label: "12", value: "2" },
  { label: "14", value: "3" },
  { label: "16", value: "4" },
  { label: "18", value: "5" },
  { label: "24", value: "6" },
  { label: "32", value: "7" },
];

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => {
        // Human: Prevent contenteditable from losing selection before the command runs.
        event.preventDefault();
      }}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 hidden h-5 w-px bg-edge sm:block" aria-hidden />;
}

export function RtfEditorToolbar({ disabled, onCommand, className }: RtfEditorToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-0.5 border-b border-edge bg-surface px-2 py-1.5 sm:px-3",
        className,
      )}
    >
      <ToolButton label="Undo" disabled={disabled} onClick={() => onCommand("undo")}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton label="Redo" disabled={disabled} onClick={() => onCommand("redo")}>
        <Redo2 className="size-4" />
      </ToolButton>

      <Divider />

      <label className="sr-only" htmlFor="rtf-font-family">
        Font family
      </label>
      <select
        id="rtf-font-family"
        disabled={disabled}
        defaultValue="Helvetica"
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => onCommand("fontName", event.target.value)}
        className="h-8 max-w-[8.5rem] rounded-md border border-edge bg-panel px-1.5 text-xs text-ink"
      >
        {FONT_FAMILIES.map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>
            {font}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="rtf-font-size">
        Font size
      </label>
      <select
        id="rtf-font-size"
        disabled={disabled}
        defaultValue="3"
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => onCommand("fontSize", event.target.value)}
        className="h-8 rounded-md border border-edge bg-panel px-1.5 text-xs text-ink"
      >
        {FONT_SIZES.map((size) => (
          <option key={size.value} value={size.value}>
            {size.label}
          </option>
        ))}
      </select>

      <Divider />

      <ToolButton label="Bold" disabled={disabled} onClick={() => onCommand("bold")}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton label="Italic" disabled={disabled} onClick={() => onCommand("italic")}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton label="Underline" disabled={disabled} onClick={() => onCommand("underline")}>
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton label="Strikethrough" disabled={disabled} onClick={() => onCommand("strikeThrough")}>
        <Strikethrough className="size-4" />
      </ToolButton>
      <ToolButton label="Superscript" disabled={disabled} onClick={() => onCommand("superscript")}>
        <Superscript className="size-4" />
      </ToolButton>
      <ToolButton label="Subscript" disabled={disabled} onClick={() => onCommand("subscript")}>
        <Subscript className="size-4" />
      </ToolButton>

      <Divider />

      <label className="inline-flex h-8 items-center gap-1 rounded-md border border-edge bg-panel px-1.5 text-[11px] text-ink-muted">
        A
        <input
          type="color"
          disabled={disabled}
          defaultValue="#1A1A1A"
          aria-label="Text color"
          onMouseDown={(event) => event.preventDefault()}
          onChange={(event) => onCommand("foreColor", event.target.value)}
          className="size-5 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
      <label className="inline-flex h-8 items-center gap-1 rounded-md border border-edge bg-panel px-1.5 text-[11px] text-ink-muted">
        <Highlighter className="size-3.5" />
        <input
          type="color"
          disabled={disabled}
          defaultValue="#FFF59D"
          aria-label="Highlight color"
          onMouseDown={(event) => event.preventDefault()}
          onChange={(event) => onCommand("hiliteColor", event.target.value)}
          className="size-5 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>

      <Divider />

      <ToolButton label="Align left" disabled={disabled} onClick={() => onCommand("justifyLeft")}>
        <AlignLeft className="size-4" />
      </ToolButton>
      <ToolButton label="Align center" disabled={disabled} onClick={() => onCommand("justifyCenter")}>
        <AlignCenter className="size-4" />
      </ToolButton>
      <ToolButton label="Align right" disabled={disabled} onClick={() => onCommand("justifyRight")}>
        <AlignRight className="size-4" />
      </ToolButton>
      <ToolButton label="Justify" disabled={disabled} onClick={() => onCommand("justifyFull")}>
        <AlignJustify className="size-4" />
      </ToolButton>

      <Divider />

      <ToolButton label="Bulleted list" disabled={disabled} onClick={() => onCommand("insertUnorderedList")}>
        <List className="size-4" />
      </ToolButton>
      <ToolButton label="Numbered list" disabled={disabled} onClick={() => onCommand("insertOrderedList")}>
        <ListOrdered className="size-4" />
      </ToolButton>
      <ToolButton label="Clear formatting" disabled={disabled} onClick={() => onCommand("removeFormat")}>
        <RemoveFormatting className="size-4" />
      </ToolButton>
    </div>
  );
}
