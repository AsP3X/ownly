// Human: Presentational shell for Edit User Account — 1:1 login-signup.pencil frame IlfEv.
// Agent: RENDERS layout only; parent supplies state and handlers.

import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SetupToggleRow } from "@/components/setup/SetupToggleRow";
import type { AdminUserRoleTier } from "@/lib/utils-app";

const ROLE_OPTIONS: { id: AdminUserRoleTier; label: string }[] = [
  { id: "standard", label: "Standard User" },
  { id: "pro", label: "Pro User" },
  { id: "admin", label: "Administrator" },
];

/** Human: Horizontal rule between dialog header, body, and footer. */
export function AdminEditUserDivider() {
  return <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />;
}

/** Human: Account status row with green toggle per Pencil mpe3h frame. */
export function AdminEditUserStatusRow({
  enabled,
  disabled,
  onEnabledChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <SetupToggleRow
      title="Account Status"
      description="Allow user to log in and sync their files"
      checked={enabled}
      onCheckedChange={onEnabledChange}
      disabled={disabled}
      switchClassName="h-6 w-11 data-checked:bg-[#10B981] data-unchecked:bg-[#E5E7EB] [&_[data-slot=switch-thumb]]:size-[18px]"
    />
  );
}

/** Human: Three-way role segmented control per Pencil X1iIP frame. */
export function AdminEditUserRoleSegments({
  value,
  disabled,
  onChange,
}: {
  value: AdminUserRoleTier;
  disabled?: boolean;
  onChange: (tier: AdminUserRoleTier) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-[#1A1A1A]">System Role</p>
      <div className="flex gap-2">
        {ROLE_OPTIONS.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={cn(
                "flex flex-1 items-center justify-center rounded-lg border px-3 py-2.5 text-[13px] transition-colors",
                selected
                  ? "border-[#2563EB] bg-[#EFF6FF] font-medium text-[#2563EB]"
                  : "border-[#E5E7EB] bg-white font-normal text-[#666666] hover:border-[#D1D5DB]",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Human: Preset per-user quota tiers shown in the edit-user storage dropdown. */
const STORAGE_QUOTA_GB_OPTIONS = [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000] as const;

// Human: Build a sorted unique option list that always includes the current quota value.
// Agent: MERGES preset tiers with quotaGb; RETURNS ascending GB values for the select.
function storageQuotaGbOptions(quotaGb: number): number[] {
  const values = new Set<number>(STORAGE_QUOTA_GB_OPTIONS);
  values.add(Math.max(1, quotaGb));
  return [...values].sort((a, b) => a - b);
}

/** Human: Storage quota field + usage bar per Pencil jSvhv frame. */
export function AdminEditUserStorageSection({
  quotaGb,
  usedBytes,
  quotaBytes,
  onQuotaGbChange,
}: {
  quotaGb: number;
  usedBytes: number;
  quotaBytes: number;
  onQuotaGbChange: (quotaGb: number) => void;
}) {
  const usedGb = usedBytes / (1024 * 1024 * 1024);
  const pct = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const options = storageQuotaGbOptions(quotaGb);

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-semibold text-[#1A1A1A]">Max Storage Capacity</p>
      <div className="relative flex h-11 items-center rounded-lg border border-[#E5E7EB] bg-white px-4">
        <select
          value={quotaGb}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (!Number.isNaN(parsed)) onQuotaGbChange(Math.max(1, parsed));
          }}
          className="w-full appearance-none bg-transparent pr-8 text-sm font-medium text-[#1A1A1A] outline-none"
          aria-label="Max storage capacity in gigabytes"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option.toLocaleString()}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-4 inline-flex items-center gap-1.5 text-sm text-[#666666]">
          GB
          <ChevronDown className="size-3.5 text-[#888888]" aria-hidden />
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-[#666666]">
          Current usage: {usedGb >= 10 ? usedGb.toFixed(0) : usedGb.toFixed(1)} GB /{" "}
          {quotaGb.toLocaleString()} GB allocated ({pct}%)
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F7F8FA]">
          <div
            className="h-full rounded-full bg-[#2563EB] transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <p className="text-[11px] text-[#888888]">
        Per-user quota overrides the instance default until you change it here.
      </p>
    </div>
  );
}

/** Human: Active sessions row + outline action per Pencil MBGuk frame. */
export function AdminEditUserSessionsRow({
  subtitle,
  onManageSessions,
}: {
  subtitle: string;
  onManageSessions: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold text-[#1A1A1A]">Active Sessions</p>
        <p className="text-xs text-[#666666]">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onManageSessions}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-[13px] font-medium text-[#666666] transition-colors hover:bg-[#F7F8FA]"
      >
        Manage Sessions
        <ChevronRight className="size-3.5 text-[#888888]" aria-hidden />
      </button>
    </div>
  );
}

/** Human: Cleanup-on-delete checkbox per Pencil riAJs frame. */
export function AdminEditUserCleanupRow({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex gap-3", disabled ? "cursor-default opacity-80" : "cursor-pointer")}>
      <span
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded border",
          checked ? "border-[#2563EB] bg-[#2563EB]" : "border-[#E5E7EB] bg-white",
        )}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        {checked ? <Check className="size-3 text-white" strokeWidth={3} aria-hidden /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-medium text-[#1A1A1A]">Clean up user files upon deletion</span>
        <span className="text-[11px] leading-relaxed text-[#666666]">
          When this user account is deleted, permanently erase all of their files and storage directories
          from active storage nodes instantly.
        </span>
      </span>
    </label>
  );
}

/** Human: Cancel + Save Changes footer per Pencil f1HBLE frame. */
export function AdminEditUserFooter({
  onCancel,
  onSave,
  saving,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="rounded-lg border border-[#E5E7EB] bg-white px-[18px] py-2.5 text-[13px] font-medium text-[#666666] transition-colors hover:bg-[#F7F8FA] disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-[#2563EB] px-[18px] py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
}

/** Human: Dialog body stack with consistent 18px gaps. */
export function AdminEditUserBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[18px]">{children}</div>;
}
