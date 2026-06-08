// Human: Fluent/Excel-style ribbon primitives — labeled groups, large buttons, tab strip.
// Agent: COMPOSED by ExcelSpreadsheetRibbon; USES excel-ribbon-tokens + scaledPx.

import type { CSSProperties, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import {
  EXCEL_RIBBON_ACTIVE_TAB,
  EXCEL_RIBBON_BORDER,
  EXCEL_RIBBON_CONTENT_BG,
  EXCEL_RIBBON_FILE_TAB,
  EXCEL_RIBBON_FILE_TAB_HOVER,
  EXCEL_RIBBON_FONT,
  EXCEL_RIBBON_GROUP_DIVIDER,
  EXCEL_RIBBON_GROUP_LABEL,
  EXCEL_RIBBON_HOVER,
  EXCEL_RIBBON_TAB_INDICATOR,
  EXCEL_RIBBON_TAB_STRIP_BG,
  EXCEL_RIBBON_TEXT,
  EXCEL_RIBBON_TEXT_SECONDARY,
} from "@/components/drive/excel/excel-ribbon-tokens";
import { cn } from "@/lib/utils";

export function RibbonGroupDivider() {
  return (
    <div
      className="mx-1 shrink-0 self-stretch"
      style={{
        width: 1,
        backgroundColor: EXCEL_RIBBON_GROUP_DIVIDER,
        marginBlock: scaledPx(4),
      }}
      aria-hidden
    />
  );
}

type RibbonGroupProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

// Human: Excel ribbon group — commands on top, gray caption label anchored at bottom.
export function RibbonGroup({ label, children, className }: RibbonGroupProps) {
  return (
    <div
      className={cn("flex shrink-0 flex-col justify-between", className)}
      style={{
        minHeight: scaledPx(88),
        paddingInline: scaledPx(6),
        fontFamily: EXCEL_RIBBON_FONT,
      }}
    >
      <div className="flex flex-1 items-center gap-0.5">{children}</div>
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
  "inline-flex flex-col items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40";

function ribbonButtonStyle(active: boolean): CSSProperties {
  return {
    backgroundColor: active ? "#CCE4D6" : "transparent",
    color: EXCEL_RIBBON_TEXT,
    fontFamily: EXCEL_RIBBON_FONT,
  };
}

// Human: Large ribbon control (Paste-style) — icon stacked above caption.
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
      className={cn(ribbonButtonBaseClass, "hover:bg-[#E5E5E5]")}
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        minWidth: scaledPx(52),
        padding: `${scaledPx(4)}px ${scaledPx(6)}px`,
        gap: scaledPx(2),
      }}
    >
      <span style={{ width: scaledPx(32), height: scaledPx(32) }} className="flex items-center justify-center">
        {icon}
      </span>
      <span className="flex items-center gap-0.5" style={{ fontSize: scaledPx(10) }}>
        {label}
        <ChevronDown className="size-2.5 opacity-60" aria-hidden />
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
      className={cn(ribbonButtonBaseClass, "hover:bg-[#E5E5E5]")}
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        minWidth: showLabel ? scaledPx(40) : scaledPx(28),
        padding: scaledPx(3),
        gap: scaledPx(1),
      }}
    >
      <span style={{ width: scaledPx(16), height: scaledPx(16) }} className="flex items-center justify-center">
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

// Human: Horizontal ribbon split — stacks small icon buttons vertically (Cut over Copy).
export function RibbonIconStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-0.5">{children}</div>;
}

type RibbonTabProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

// Human: Standard Excel ribbon tab (Home, Insert, …) — white fill when selected.
export function RibbonTab({ label, active, onClick }: RibbonTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative shrink-0 transition-colors"
      style={{
        fontFamily: EXCEL_RIBBON_FONT,
        fontSize: scaledPx(11),
        fontWeight: active ? 600 : 400,
        color: active ? EXCEL_RIBBON_TEXT : EXCEL_RIBBON_TEXT_SECONDARY,
        backgroundColor: active ? EXCEL_RIBBON_ACTIVE_TAB : "transparent",
        paddingInline: scaledPx(12),
        paddingBlock: `${scaledPx(6)}px ${scaledPx(4)}px`,
        borderTopLeftRadius: scaledPx(4),
        borderTopRightRadius: scaledPx(4),
      }}
    >
      {label}
      {active ? (
        <span
          className="absolute inset-x-1 bottom-0"
          style={{ height: 2, backgroundColor: EXCEL_RIBBON_TAB_INDICATOR }}
          aria-hidden
        />
      ) : null}
    </button>
  );
}

type RibbonFileTabProps = {
  active: boolean;
  onClick: () => void;
};

// Human: Excel green File tab — always leftmost on the tab strip.
export function RibbonFileTab({ active, onClick }: RibbonFileTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 font-semibold text-white transition-colors"
      style={{
        fontFamily: EXCEL_RIBBON_FONT,
        fontSize: scaledPx(11),
        backgroundColor: active ? EXCEL_RIBBON_FILE_TAB : EXCEL_RIBBON_FILE_TAB,
        paddingInline: scaledPx(14),
        paddingBlock: scaledPx(6),
        borderTopLeftRadius: scaledPx(2),
        borderTopRightRadius: scaledPx(2),
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.backgroundColor = EXCEL_RIBBON_FILE_TAB_HOVER;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = EXCEL_RIBBON_FILE_TAB;
      }}
    >
      File
    </button>
  );
}

type RibbonTabStripProps = {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onFileTab: () => void;
  fileActive: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

// Human: Full Excel tab row — File tab + scrollable tabs + collapse chevron.
export function RibbonTabStrip({
  tabs,
  activeTab,
  onTabChange,
  onFileTab,
  fileActive,
  collapsed,
  onToggleCollapse,
}: RibbonTabStripProps) {
  return (
    <div
      className="flex shrink-0 items-end justify-between border-b"
      style={{
        backgroundColor: EXCEL_RIBBON_TAB_STRIP_BG,
        borderColor: EXCEL_RIBBON_BORDER,
        minHeight: scaledPx(28),
        paddingInline: scaledPx(4),
      }}
    >
      <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
        <RibbonFileTab active={fileActive} onClick={onFileTab} />
        {tabs.map((tab) => (
          <RibbonTab
            key={tab.id}
            label={tab.label}
            active={!fileActive && activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
          />
        ))}
      </div>
      <button
        type="button"
        aria-label={collapsed ? "Expand ribbon" : "Collapse ribbon"}
        onClick={onToggleCollapse}
        className="mb-0.5 shrink-0 rounded px-2 py-1 text-[#605E5C] hover:bg-[#E5E5E5]"
        style={{ fontSize: scaledPx(12) }}
      >
        {collapsed ? "⌃" : "⌃"}
      </button>
    </div>
  );
}

type RibbonContentProps = {
  children: ReactNode;
  collapsed: boolean;
};

// Human: White command area below tabs — horizontally scrollable group row.
export function RibbonContent({ children, collapsed }: RibbonContentProps) {
  if (collapsed) return null;
  return (
    <div
      className="overflow-x-auto border-b"
      style={{
        backgroundColor: EXCEL_RIBBON_CONTENT_BG,
        borderColor: EXCEL_RIBBON_BORDER,
        minHeight: scaledPx(96),
      }}
    >
      <div className="flex min-w-max items-stretch px-1 py-1">{children}</div>
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
        fontSize: scaledPx(11),
        fontFamily: EXCEL_RIBBON_FONT,
        borderColor: EXCEL_RIBBON_BORDER,
        padding: `${scaledPx(2)}px ${scaledPx(4)}px`,
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
      className="rounded-sm transition-colors hover:bg-[#E5E5E5] disabled:opacity-40"
      style={{
        ...ribbonButtonStyle(Boolean(active)),
        padding: scaledPx(4),
        backgroundColor: active ? EXCEL_RIBBON_HOVER : "transparent",
      }}
    >
      {children}
    </button>
  );
}
