// Human: Ribbon dropdown for applying conditional formatting presets to the selected column.
// Agent: EMITS ConditionalFormatRule[]; READS selection context from dialog parent.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Palette } from "lucide-react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import type { ConditionalFormatRule } from "@/lib/spreadsheet/conditional-formatting";
import { cn } from "@/lib/utils";

export type ConditionalFormatPreset =
  | { kind: "greaterThan"; value: number; style: { backgroundColor: string; textColor?: string } }
  | { kind: "lessThan"; value: number; style: { backgroundColor: string; textColor?: string } }
  | { kind: "equal"; value: string | number; style: { backgroundColor: string; textColor?: string } }
  | { kind: "textContains"; value: string; style: { backgroundColor: string; textColor?: string } }
  | { kind: "colorScale"; minColor: string; maxColor: string }
  | { kind: "dataBar"; color: string }
  | { kind: "statusPresets" }
  | { kind: "clear" };

type ExcelConditionalFormatMenuProps = {
  disabled?: boolean;
  onApplyPreset: (preset: ConditionalFormatPreset) => void;
};

type MenuItem = {
  label: string;
  preset?: ConditionalFormatPreset;
  prompt?: { title: string; defaultValue: string };
  children?: MenuItem[];
};

const MENU: MenuItem[] = [
  {
    label: "Highlight Cell Rules",
    children: [
      {
        label: "Greater Than…",
        prompt: { title: "Highlight cells greater than:", defaultValue: "5000" },
        preset: { kind: "greaterThan", value: 0, style: { backgroundColor: "#FEE2E2", textColor: "#B91C1C" } },
      },
      {
        label: "Less Than…",
        prompt: { title: "Highlight cells less than:", defaultValue: "1000" },
        preset: { kind: "lessThan", value: 0, style: { backgroundColor: "#DBEAFE", textColor: "#1D4ED8" } },
      },
      {
        label: "Equal To…",
        prompt: { title: "Highlight cells equal to:", defaultValue: "On Track" },
        preset: { kind: "equal", value: "", style: { backgroundColor: "#D1FAE5", textColor: "#047857" } },
      },
      {
        label: "Text Contains…",
        prompt: { title: "Highlight cells containing:", defaultValue: "Budget" },
        preset: { kind: "textContains", value: "", style: { backgroundColor: "#FEF3C7", textColor: "#92400E" } },
      },
    ],
  },
  {
    label: "Color Scales",
    children: [
      {
        label: "Green → Red Scale",
        preset: { kind: "colorScale", minColor: "#FEE2E2", maxColor: "#D1FAE5" },
      },
      {
        label: "Blue → White Scale",
        preset: { kind: "colorScale", minColor: "#FFFFFF", maxColor: "#2563EB" },
      },
    ],
  },
  {
    label: "Data Bars",
    children: [
      {
        label: "Blue Data Bar",
        preset: { kind: "dataBar", color: "#2563EB" },
      },
    ],
  },
  {
    label: "Status Presets (Pencil)",
    preset: { kind: "statusPresets" },
  },
  {
    label: "Clear Rules from Column",
    preset: { kind: "clear" },
  },
];

function applyPromptValue(preset: ConditionalFormatPreset, raw: string): ConditionalFormatPreset {
  const numeric = Number(raw.replace(/[$,%\s,]/g, ""));
  switch (preset.kind) {
    case "greaterThan":
      return { ...preset, value: Number.isFinite(numeric) ? numeric : 0 };
    case "lessThan":
      return { ...preset, value: Number.isFinite(numeric) ? numeric : 0 };
    case "equal":
      return { ...preset, value: Number.isFinite(numeric) ? numeric : raw };
    case "textContains":
      return { ...preset, value: raw };
    default:
      return preset;
  }
}

export function ExcelConditionalFormatMenu({ disabled = false, onApplyPreset }: ExcelConditionalFormatMenuProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setExpanded(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleItemClick = (item: MenuItem) => {
    if (item.children) {
      setExpanded((current) => (current === item.label ? null : item.label));
      return;
    }
    if (!item.preset) return;

    if (item.prompt) {
      const raw = window.prompt(item.prompt.title, item.prompt.defaultValue);
      if (raw === null) return;
      onApplyPreset(applyPromptValue(item.preset, raw));
    } else {
      onApplyPreset(item.preset);
    }

    setOpen(false);
    setExpanded(null);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-[#323130] transition-colors hover:bg-[#F3F2F1] disabled:opacity-50",
          open && "bg-[#E1DFDD]",
        )}
        style={{ padding: `${scaledPx(2)}px ${scaledPx(4)}px`, fontSize: scaledPx(8) }}
      >
        <Palette style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
        Conditional Formatting
        <ChevronDown style={{ width: scaledPx(10), height: scaledPx(10) }} className="opacity-70" aria-hidden />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-lg"
          role="menu"
        >
          {MENU.map((item) => (
            <div key={item.label}>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleItemClick(item)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-[#1A1A1A] hover:bg-[#F7F8FA]"
              >
                {item.label}
                {item.children ? <ChevronDown className="size-3 rotate-[-90deg] text-[#666666]" aria-hidden /> : null}
              </button>
              {item.children && expanded === item.label ? (
                <div className="border-t border-[#F3F4F6] bg-[#FAFAFA] py-1 pl-2">
                  {item.children.map((child) => (
                    <button
                      key={child.label}
                      type="button"
                      role="menuitem"
                      onClick={() => handleItemClick(child)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-[#444444] hover:bg-white"
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Human: Convert a ribbon preset into one or more ConditionalFormatRule objects for the active column.
// Agent: READS preset + range + nextPriority; RETURNS rules to merge into SheetData.
export function rulesFromPreset(
  preset: ConditionalFormatPreset,
  range: ConditionalFormatRule["range"],
  nextPriority: number,
): ConditionalFormatRule[] {
  const id = () => crypto.randomUUID();

  switch (preset.kind) {
    case "greaterThan":
      return [
        {
          id: id(),
          priority: nextPriority,
          range,
          type: "cellIs",
          operator: "greaterThan",
          value: String(preset.value),
          style: preset.style,
        },
      ];
    case "lessThan":
      return [
        {
          id: id(),
          priority: nextPriority,
          range,
          type: "cellIs",
          operator: "lessThan",
          value: String(preset.value),
          style: preset.style,
        },
      ];
    case "equal":
      return [
        {
          id: id(),
          priority: nextPriority,
          range,
          type: "text",
          operator: "equal",
          value: typeof preset.value === "number" ? String(preset.value) : `"${preset.value}"`,
          style: preset.style,
        },
      ];
    case "textContains":
      return [
        {
          id: id(),
          priority: nextPriority,
          range,
          type: "text",
          operator: "textContains",
          value: `"${preset.value}"`,
          style: preset.style,
        },
      ];
    case "colorScale":
      return [
        {
          id: id(),
          priority: nextPriority,
          range,
          type: "colorScale",
          colorScale: { minColor: preset.minColor, maxColor: preset.maxColor },
        },
      ];
    case "dataBar":
      return [
        {
          id: id(),
          priority: nextPriority,
          range,
          type: "dataBar",
          dataBar: { color: preset.color },
        },
      ];
    default:
      return [];
  }
}
