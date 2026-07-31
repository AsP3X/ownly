// Human: Presentational shell for Edit User Account — 1:1 login-signup.pencil frame IlfEv.
// Agent: RENDERS layout only; parent supplies state and handlers.

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
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
  return <div className="h-px w-full bg-edge" aria-hidden />;
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
      switchClassName="h-6 w-11 data-checked:bg-ok data-unchecked:bg-edge [&_[data-slot=switch-thumb]]:size-[18px]"
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
      <p className="text-sm font-semibold text-ink">System Role</p>
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
                  ? "border-brand bg-brand-weak font-medium text-brand"
                  : "border-edge bg-panel font-normal text-ink-muted hover:border-edge",
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
  // Human: Local draft avoids fighting the input while the admin types multi-digit GB values.
  // Agent: SYNCED from quotaGb prop; PARSED into onQuotaGbChange when value is a valid integer >= 1.
  const [quotaDraft, setQuotaDraft] = useState(String(quotaGb));

  useEffect(() => {
    setQuotaDraft(String(quotaGb));
  }, [quotaGb]);

  const usedGb = usedBytes / (1024 * 1024 * 1024);
  const pct = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-semibold text-ink">Max Storage Capacity</p>
      <div className="flex h-11 items-center rounded-lg border border-edge bg-panel px-4">
        <input
          type="number"
          min={1}
          step={1}
          value={quotaDraft}
          onChange={(event) => {
            const next = event.target.value;
            setQuotaDraft(next);
            const parsed = Number.parseInt(next, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
              onQuotaGbChange(parsed);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none"
          aria-label="Max storage capacity in gigabytes"
        />
        <span className="shrink-0 text-sm text-ink-muted">GB</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-ink-muted">
          Current usage: {usedGb >= 10 ? usedGb.toFixed(0) : usedGb.toFixed(1)} GB /{" "}
          {quotaGb.toLocaleString()} GB allocated ({pct}%)
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <p className="text-[11px] text-ink-faint">
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
        <p className="text-sm font-semibold text-ink">Active Sessions</p>
        <p className="text-xs text-ink-muted">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onManageSessions}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-panel px-4 py-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface"
      >
        Manage Sessions
        <ChevronRight className="size-3.5 text-ink-faint" aria-hidden />
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
          checked ? "border-brand bg-brand" : "border-edge bg-panel",
        )}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        {checked ? <Check className="size-3 text-brand-on" strokeWidth={3} aria-hidden /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-medium text-ink">Clean up user files upon deletion</span>
        <span className="text-[11px] leading-relaxed text-ink-muted">
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
        className="rounded-lg border border-edge bg-panel px-[18px] py-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-brand px-[18px] py-2.5 text-[13px] font-medium text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-60"
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
