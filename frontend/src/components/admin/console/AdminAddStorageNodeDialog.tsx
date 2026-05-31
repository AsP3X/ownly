// Human: Add Storage Node modal — login-signup.pencil dialog (frame Y5S00).
// Agent: CALLS createAdminStorageNode; WRITES storage_nodes row; REFRESHES parent list on success.

import { useState } from "react";
import {
  ChevronDown,
  Film,
  Loader2,
  Users,
  X,
} from "lucide-react";
import {
  createAdminStorageNode,
  getErrorMessage,
  type StorageCapacityUnit,
} from "@/api/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type DeploymentTab = "docker" | "remote";

const CAPACITY_UNITS: StorageCapacityUnit[] = ["MB", "GB", "TB"];

const DEFAULT_FORM = {
  nodeName: "",
  regionLabel: "",
  baseUrl: "http://object-storage-b:9000",
  targetCapacityValue: "512",
  targetCapacityUnit: "GB" as StorageCapacityUnit,
};

/** Human: Field label + bordered input matching Pencil 40px input boxes. */
export function DialogField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-[#666666]">{label}</label>
      <div className="flex h-10 items-center rounded-lg border border-[#E5E7EB] bg-white px-3">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(event) => onChange?.(event.target.value)}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm text-[#1A1A1A] outline-none placeholder:text-[#888888]",
            readOnly && "cursor-default text-[#666666]",
          )}
        />
      </div>
    </div>
  );
}

/** Human: Target capacity value + MB/GB/TB unit selector per Pencil Target Capacity field. */
export function DialogCapacityField({
  value,
  unit,
  onValueChange,
  onUnitChange,
}: {
  value: string;
  unit: StorageCapacityUnit;
  onValueChange: (value: string) => void;
  onUnitChange: (unit: StorageCapacityUnit) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-[#666666]">Target Capacity</label>
      <div className="flex gap-2">
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-[#E5E7EB] bg-white px-3">
          <input
            type="number"
            min={0}
            step="any"
            value={value}
            placeholder="512"
            onChange={(event) => onValueChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-[#1A1A1A] outline-none placeholder:text-[#888888]"
          />
        </div>
        <div className="relative shrink-0">
          <select
            value={unit}
            onChange={(event) => onUnitChange(event.target.value as StorageCapacityUnit)}
            className="h-10 appearance-none rounded-lg border border-[#E5E7EB] bg-white pl-3 pr-8 text-sm font-medium text-[#1A1A1A] outline-none"
            aria-label="Capacity unit"
          >
            {CAPACITY_UNITS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-[#666666]"
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

/** Human: Toggle row with icon + title inside allocation panel. */
function AllocationToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className="mt-0.5 size-4 shrink-0 text-[#666666]" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[13px] font-semibold text-[#1A1A1A]">{title}</p>
            <p className="text-[11px] leading-relaxed text-[#666666]">{description}</p>
          </div>
        </div>
        {/* Agent: 44×24 toggle per Pencil JgzzS frame. */}
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          className="h-6 w-11 shrink-0 data-checked:bg-[#2563EB] data-unchecked:bg-[#E5E7EB] [&_[data-slot=switch-thumb]]:size-5"
        />
      </div>
      {checked ? children : null}
    </div>
  );
}

/** Human: Add Storage Node dialog — registers node via Storage Nodes Network API. */
export function AdminAddStorageNodeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [deploymentTab, setDeploymentTab] = useState<DeploymentTab>("docker");
  const [nodeName, setNodeName] = useState(DEFAULT_FORM.nodeName);
  const [regionLabel, setRegionLabel] = useState(DEFAULT_FORM.regionLabel);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_FORM.baseUrl);
  const [targetCapacityValue, setTargetCapacityValue] = useState(DEFAULT_FORM.targetCapacityValue);
  const [targetCapacityUnit, setTargetCapacityUnit] = useState<StorageCapacityUnit>(
    DEFAULT_FORM.targetCapacityUnit,
  );
  const [tenantIsolation, setTenantIsolation] = useState(true);
  const [mediaOptimization, setMediaOptimization] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setDeploymentTab("docker");
    setNodeName(DEFAULT_FORM.nodeName);
    setRegionLabel(DEFAULT_FORM.regionLabel);
    setBaseUrl(DEFAULT_FORM.baseUrl);
    setTargetCapacityValue(DEFAULT_FORM.targetCapacityValue);
    setTargetCapacityUnit(DEFAULT_FORM.targetCapacityUnit);
    setTenantIsolation(true);
    setMediaOptimization(true);
    setError(null);
  }

  function handleClose() {
    onOpenChange(false);
    resetForm();
  }

  async function handleProvision() {
    setError(null);
    const capacity = Number.parseFloat(targetCapacityValue);
    if (!nodeName.trim()) {
      setError("Node name is required.");
      return;
    }
    if (!regionLabel.trim()) {
      setError("Region label is required.");
      return;
    }
    if (!baseUrl.trim()) {
      setError("Storage endpoint URL is required.");
      return;
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setError("Target capacity must be a positive number.");
      return;
    }

    setSubmitting(true);
    try {
      await createAdminStorageNode({
        id: nodeName.trim(),
        region_label: regionLabel.trim(),
        base_url: baseUrl.trim(),
        target_capacity_value: capacity,
        target_capacity_unit: targetCapacityUnit,
      });
      onCreated();
      handleClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] w-full max-w-[680px] flex-col gap-5 overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_12px_32px_-4px_#00000026] sm:max-w-[680px]"
        overlayClassName="bg-black/30"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1A1A1A]">Add Storage Node</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="flex size-8 items-center justify-center rounded-full text-[#666666] transition-colors hover:bg-[#F7F8FA]"
            aria-label="Close dialog"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />

        <p className="text-sm text-[#666666]">
          Register an additional standalone Nebular OS endpoint. File uploads continue to use the
          primary object storage URL configured at setup until routing is extended.
        </p>

        <div className="flex gap-1 rounded-lg bg-[#F7F8FA] p-1">
          {(
            [
              { id: "docker" as const, label: "Docker Stack Deployment" },
              { id: "remote" as const, label: "Remote SSH Node" },
            ] as const
          ).map((tab) => {
            const active = deploymentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDeploymentTab(tab.id)}
                className={cn(
                  "flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-white font-semibold text-[#1A1A1A] shadow-[0_1px_2px_#0000000D]"
                    : "font-normal text-[#666666] hover:text-[#1A1A1A]",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <DialogField
              label="Node Name"
              value={nodeName}
              onChange={setNodeName}
              placeholder="node-b"
            />
            <DialogField
              label="Region Label"
              value={regionLabel}
              onChange={setRegionLabel}
              placeholder="Frankfurt, DE"
            />
          </div>
          <DialogField
            label="Storage Endpoint URL"
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder={
              deploymentTab === "docker"
                ? "http://object-storage-b:9000"
                : "https://storage.example.com:9000"
            }
          />
          <DialogCapacityField
            value={targetCapacityValue}
            unit={targetCapacityUnit}
            onValueChange={setTargetCapacityValue}
            onUnitChange={setTargetCapacityUnit}
          />
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] p-4">
          <AllocationToggleRow
            icon={Users}
            title="Dedicated Tenant Isolation"
            description="Restrict this node to a single tenant's data."
            checked={tenantIsolation}
            onCheckedChange={setTenantIsolation}
          >
            <div className="flex h-9 items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-3">
              <span className="text-[13px] text-[#1A1A1A]">Enterprise: Alpha Corp</span>
              <ChevronDown className="size-3.5 text-[#666666]" aria-hidden />
            </div>
          </AllocationToggleRow>

          <AllocationToggleRow
            icon={Film}
            title="Media Workload Optimization"
            description="Dedicate node storage to a specific media type."
            checked={mediaOptimization}
            onCheckedChange={setMediaOptimization}
          >
            <div className="flex h-9 items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-3">
              <span className="text-[13px] text-[#1A1A1A]">Media Class: Video & Streaming</span>
              <ChevronDown className="size-3.5 text-[#666666]" aria-hidden />
            </div>
          </AllocationToggleRow>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleProvision()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Provisioning…
              </>
            ) : (
              "Provision Node"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
