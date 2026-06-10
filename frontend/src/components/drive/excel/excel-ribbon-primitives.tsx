// Human: macOS Excel ribbon primitives — title-bar controls, tab strip, and command groups per excel-editor-dialog.pen.
// Agent: COMPOSED by ExcelSpreadsheetRibbon and ExcelToolbarTitleBar; USES excel-ribbon-tokens + scaledPx.

import type { CSSProperties, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import {
  EXCEL_RIBBON_BORDER,
  EXCEL_RIBBON_CONTENT_BG,
  EXCEL_RIBBON_FONT,
  EXCEL_RIBBON_GROUP_DIVIDER,
  EXCEL_RIBBON_GROUP_LABEL,
  EXCEL_RIBBON_TAB_INDICATOR,
  EXCEL_RIBBON_TAB_STRIP_BG,
  EXCEL_RIBBON_TEXT,
  EXCEL_RIBBON_TEXT_SECONDARY,
} from "@/components/drive/excel/excel-ribbon-tokens";
import { cn } from "@/lib/utils";

export function RibbonGroupDivider() {
  return (
    <div
      className="mx-1 shrink-0 self-center"
      style={{
        width: 1,
        height: scaledPx(60),
        backgroundColor: EXCEL_RIBBON_GROUP_DIVIDER,
      }}
      aria-hidden
    />
  );
}

type RibbonGroupProps = {
  label?: string;
  children: ReactNode;
  className?: string;
  /** Human: macOS pen layout hides group captions — pass true to show Excel-style footer labels. */
  showLabel?: boolean;
};

// Human: Ribbon command cluster — optional gray caption (off by default in macOS toolbar).
export function RibbonGroup({ label, children, className, showLabel = false }: RibbonGroupProps) {
  return (
    <div
      className={cn("flex shrink-0 flex-col justify-center", className)}
      style={{
        minHeight: scaledPx(72),
        paddingInline: scaledPx(4),
        fontFamily: EXCEL_RIBBON_FONT,
      }}
    >
      <div className="flex flex-1 items-center gap-0.5">{children}</div>
      {showLabel && label ? (
        <p
          className="mt-1 text-center leading-none"
          style={{
            fontSize: scaledPx(10),
            color: EXCEL_RIBBON_GROUP_LABEL,
            paddingBottom: scaledPx(2),
          }}
        >
          {label}
        </p>
      ) : null}
    </div>
  );
}

type RibbonButtonBaseProps = {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
};

const ribbonButtonBaseClass =
  "inline-flex items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40";

function ribbonButtonStyle(active: boolean): CSSProperties {
  return {
    backgroundColor: active ? "#E1DFDD" : "transparent",
    color: EXCEL_RIBBON_TEXT,
    fontFamily: EXCEL_RIBBON_FONT,
  };
}

// Human: Large Paste-style control — 24px icon stacked above caption + chevron.
export function RibbonLargeButton({
  label,
  icon,
  active,
  disabled,
  onClick,
  title,
}: RibbonButtonBaseProps) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(ribbonButtonBaseClass, "flex-col hover:bg-[#F3F2F1]")}
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        minWidth: scaledPx(48),
        padding: `${scaledPx(4)}px ${scaledPx(6)}px`,
        gap: scaledPx(2),
      }}
    >
      <span style={{ width: scaledPx(24), height: scaledPx(24) }} className="flex items-center justify-center">
        {icon}
      </span>
      <span className="flex items-center gap-0.5" style={{ fontSize: scaledPx(10) }}>
        {label}
        <ChevronDown style={{ width: scaledPx(10), height: scaledPx(10) }} className="opacity-70" aria-hidden />
      </span>
    </button>
  );
}

// Human: Compact ribbon icon button with optional caption below (Cut, Copy, etc.).
export function RibbonIconButton({
  label,
  icon,
  active,
  disabled,
  onClick,
  title,
  showLabel = true,
}: RibbonButtonBaseProps & { showLabel?: boolean }) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(ribbonButtonBaseClass, "flex-col hover:bg-[#F3F2F1]")}
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        minWidth: showLabel ? scaledPx(36) : scaledPx(28),
        padding: scaledPx(4),
        gap: scaledPx(1),
      }}
    >
      <span style={{ width: scaledPx(14), height: scaledPx(14) }} className="flex items-center justify-center">
        {icon}
      </span>
      {showLabel ? (
        <span style={{ fontSize: scaledPx(9), lineHeight: 1.1, maxWidth: scaledPx(48) }} className="text-center">
          {label}
        </span>
      ) : null}
    </button>
  );
}

// Human: 22×22 square icon cell used in Alignment group (pen layout).
export function RibbonSquareIconButton({
  ariaLabel,
  active,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(ribbonButtonBaseClass, "hover:bg-[#F3F2F1]")}
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        width: scaledPx(22),
        height: scaledPx(22),
      }}
    >
      {children}
    </button>
  );
}

// Human: Horizontal compact command (AutoSum, Insert ▾) from Editing / Cells groups.
export function RibbonCompactButton({
  label,
  icon,
  active,
  disabled,
  onClick,
  title,
  showChevron = false,
}: RibbonButtonBaseProps & { showChevron?: boolean }) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(ribbonButtonBaseClass, "hover:bg-[#F3F2F1]")}
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        gap: scaledPx(4),
        padding: `${scaledPx(2)}px ${scaledPx(4)}px`,
        fontSize: scaledPx(9),
      }}
    >
      {icon}
      <span>{label}</span>
      {showChevron ? (
        <ChevronDown style={{ width: scaledPx(10), height: scaledPx(10) }} className="opacity-70" aria-hidden />
      ) : null}
    </button>
  );
}

// Human: Font-color / fill-color control — glyph with swatch bar (pen Group Font).
export function RibbonColorButton({
  ariaLabel,
  disabled,
  value,
  onChange,
  variant,
}: {
  ariaLabel: string;
  disabled?: boolean;
  value: string;
  onChange: (color: string) => void;
  variant: "font" | "fill";
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer flex-col items-center rounded-sm hover:bg-[#F3F2F1]",
        disabled && "cursor-not-allowed opacity-40",
      )}
      style={{ padding: scaledPx(4), gap: scaledPx(2) }}
      title={ariaLabel}
    >
      {variant === "font" ? (
        <span style={{ fontSize: scaledPx(12), fontWeight: 700, color: EXCEL_RIBBON_TEXT, lineHeight: 1 }}>A</span>
      ) : (
        <span style={{ width: scaledPx(14), height: scaledPx(14) }} className="flex items-center justify-center text-[#323130]">
          {/* Human: paint-bucket stand-in — lucide PaintBucket may be missing in older lucide; use fill rect */}
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
            <path
              d="M19 11H5m14 0a2 2 0 0 1 0 4H5a2 2 0 0 1 0-4m14 0V9a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2"
              fill="currentColor"
            />
          </svg>
        </span>
      )}
      <span
        className="rounded-[1px]"
        style={{ width: scaledPx(14), height: scaledPx(3), backgroundColor: value }}
        aria-hidden
      />
      <input
        type="color"
        aria-label={ariaLabel}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="sr-only"
      />
    </label>
  );
}

// Human: Horizontal ribbon split — stacks small icon buttons vertically (Cut over Copy).
export function RibbonIconStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-0.5">{children}</div>;
}

type RibbonTabProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

// Human: macOS ribbon tab — bottom-aligned label with green underline when active (no white fill).
export function RibbonTab({ label, active, onClick }: RibbonTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative shrink-0 transition-colors hover:bg-[#EBEBEB]"
      style={{
        fontFamily: EXCEL_RIBBON_FONT,
        fontSize: scaledPx(12),
        fontWeight: active ? 600 : 400,
        color: active ? EXCEL_RIBBON_TEXT : EXCEL_RIBBON_TEXT_SECONDARY,
        paddingInline: scaledPx(14),
        paddingTop: scaledPx(8),
        paddingBottom: scaledPx(6),
      }}
    >
      {label}
      {active ? (
        <span
          className="absolute inset-x-2 bottom-0 mx-auto"
          style={{
            height: scaledPx(2),
            maxWidth: scaledPx(48),
            backgroundColor: EXCEL_RIBBON_TAB_INDICATOR,
          }}
          aria-hidden
        />
      ) : null}
    </button>
  );
}

type RibbonTabStripProps = {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  overflowTabs?: { id: string; label: string }[];
  onOverflowTab?: (id: string) => void;
};

// Human: macOS tab row — scrollable tabs aligned to bottom of 32px strip; optional overflow menu.
export function RibbonTabStrip({
  tabs,
  activeTab,
  onTabChange,
  overflowTabs,
  onOverflowTab,
}: RibbonTabStripProps) {
  const overflowActive = overflowTabs?.some((tab) => tab.id === activeTab) ?? false;

  return (
    <div
      className="flex shrink-0 items-end border-b"
      style={{
        backgroundColor: EXCEL_RIBBON_TAB_STRIP_BG,
        borderColor: EXCEL_RIBBON_BORDER,
        minHeight: scaledPx(32),
        paddingInline: scaledPx(8),
      }}
    >
      <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
        {tabs.map((tab) => (
          <RibbonTab
            key={tab.id}
            label={tab.label}
            active={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
          />
        ))}
      </div>
      {overflowTabs && overflowTabs.length > 0 && onOverflowTab ? (
        <div className="relative mb-1 shrink-0">
          <select
            aria-label="More ribbon tabs"
            value={overflowActive ? activeTab : ""}
            onChange={(event) => {
              if (event.target.value) onOverflowTab(event.target.value);
            }}
            className="rounded-sm border-0 bg-transparent outline-none hover:bg-[#EBEBEB]"
            style={{
              fontFamily: EXCEL_RIBBON_FONT,
              fontSize: scaledPx(11),
              color: overflowActive ? EXCEL_RIBBON_TEXT : EXCEL_RIBBON_TEXT_SECONDARY,
              padding: `${scaledPx(4)}px ${scaledPx(8)}px`,
            }}
          >
            <option value="">{overflowActive ? overflowTabs.find((t) => t.id === activeTab)?.label : "More…"}</option>
            {overflowTabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

type RibbonContentProps = {
  children: ReactNode;
};

// Human: White command area below tabs — horizontally scrollable group row (96px).
export function RibbonContent({ children }: RibbonContentProps) {
  return (
    <div
      className="overflow-x-auto border-b"
      style={{
        backgroundColor: EXCEL_RIBBON_CONTENT_BG,
        borderColor: EXCEL_RIBBON_BORDER,
        minHeight: scaledPx(96),
      }}
    >
      <div
        className="flex min-w-max items-center"
        style={{ padding: `${scaledPx(8)}px ${scaledPx(10)}px` }}
      >
        {children}
      </div>
    </div>
  );
}

// Human: Inline select styled like Excel Font/Number dropdowns.
export function RibbonSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
  options,
  width,
}: {
  value: string | number;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  options: { value: string | number; label: string }[];
  width: number;
}) {
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-sm border bg-white outline-none hover:bg-[#FAFAFA] disabled:opacity-40"
      style={{
        width: scaledPx(width),
        fontSize: scaledPx(10),
        fontFamily: EXCEL_RIBBON_FONT,
        borderColor: EXCEL_RIBBON_BORDER,
        padding: `${scaledPx(4)}px ${scaledPx(6)}px`,
        color: EXCEL_RIBBON_TEXT,
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Human: Toggle icon in a segmented control (bold/italic/align).
export function RibbonToggleButton({
  ariaLabel,
  active,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className="rounded-sm transition-colors hover:bg-[#F3F2F1] disabled:opacity-40"
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        padding: scaledPx(4),
        backgroundColor: active ? "#E1DFDD" : "transparent",
      }}
    >
      {children}
    </button>
  );
}
