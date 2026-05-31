// Human: Edit Storage Node modal — same shell as Add Storage Node (login-signup.pencil Y5S00).
// Agent: CALLS updateAdminStorageNode; READS node row from parent; REFRESHES list on success.

import { useEffect, useState } from "react";
import { Loader2, Server, X } from "lucide-react";
import {
  getErrorMessage,
  updateAdminStorageNode,
  type AdminStorageNodeRow,
  type StorageCapacityUnit,
} from "@/api/client";
import {
  DialogCapacityField,
  DialogField,
} from "@/components/admin/console/AdminAddStorageNodeDialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** Human: Pick a readable capacity unit for the edit form from stored byte counts. */
function capacityFormFromBytes(bytes: number | null | undefined): {
  value: string;
  unit: StorageCapacityUnit;
} {
  if (bytes == null || bytes <= 0) {
    return { value: "512", unit: "GB" };
  }

  const tb = 1024 ** 4;
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;

  if (bytes >= tb) {
    const value = bytes / tb;
    if (Math.abs(value - Math.round(value)) < 0.05) {
      return { value: String(Math.round(value)), unit: "TB" };
    }
  }
  if (bytes >= gb) {
    return { value: String(Math.round((bytes / gb) * 100) / 100), unit: "GB" };
  }
  return { value: String(Math.max(1, Math.round(bytes / mb))), unit: "MB" };
}

type EditFormState = {
  regionLabel: string;
  baseUrl: string;
  targetCapacityValue: string;
  targetCapacityUnit: StorageCapacityUnit;
};

function formFromNode(node: AdminStorageNodeRow): EditFormState {
  const capacity = capacityFormFromBytes(node.target_capacity_bytes);
  return {
    regionLabel: node.region_label,
    baseUrl: node.base_url || `http://${node.endpoint_host}`,
    targetCapacityValue: capacity.value,
    targetCapacityUnit: capacity.unit,
  };
}

/** Human: Edit an existing storage node — node id is fixed; endpoint and capacity are editable. */
export function AdminEditStorageNodeDialog({
  open,
  onOpenChange,
  node,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: AdminStorageNodeRow | null;
  onUpdated: () => void;
}) {
  const [form, setForm] = useState<EditFormState | null>(() => (node ? formFromNode(node) : null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Human: Re-seed the form when the parent passes a different node row.
  // Agent: READS node; WRITES form state from node.base_url + target_capacity_bytes.
  useEffect(() => {
    if (node) {
      setForm(formFromNode(node));
      setError(null);
    }
  }, [node]);

  function handleClose() {
    onOpenChange(false);
    setError(null);
  }

  async function handleSave() {
    if (!node || !form) return;

    setError(null);
    const capacity = Number.parseFloat(form.targetCapacityValue);
    if (!form.regionLabel.trim()) {
      setError("Region label is required.");
      return;
    }
    if (!form.baseUrl.trim()) {
      setError("Storage endpoint URL is required.");
      return;
    }
    if (!form.baseUrl.trim().startsWith("http://") && !form.baseUrl.trim().startsWith("https://")) {
      setError("Storage endpoint URL must start with http:// or https://");
      return;
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setError("Target capacity must be a positive number.");
      return;
    }

    setSubmitting(true);
    try {
      await updateAdminStorageNode(node.id, {
        region_label: form.regionLabel.trim(),
        base_url: form.baseUrl.trim(),
        target_capacity_value: capacity,
        target_capacity_unit: form.targetCapacityUnit,
      });
      onUpdated();
      handleClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!node || !form) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
        else onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] w-full max-w-[680px] flex-col gap-5 overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_12px_32px_-4px_#00000026] sm:max-w-[680px]"
        overlayClassName="bg-black/30"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#EFF6FF]">
              <Server className="size-4 text-[#2563EB]" aria-hidden />
            </div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">Edit Storage Node</h2>
          </div>
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
          Update the region label, endpoint URL, or target capacity for{" "}
          <span className="font-semibold text-[#1A1A1A]">{node.id}</span>. The node ID cannot be
          changed after registration.
        </p>

        <div className="flex flex-col gap-3">
          <DialogField label="Node ID" value={node.id} readOnly />
          <div className="grid gap-4 sm:grid-cols-2">
            <DialogField
              label="Region Label"
              value={form.regionLabel}
              onChange={(value) => setForm((prev) => (prev ? { ...prev, regionLabel: value } : prev))}
              placeholder="Frankfurt, DE"
            />
            <DialogField
              label="Current Status"
              value={node.status === "healthy" ? "Healthy" : "Degraded"}
              readOnly
            />
          </div>
          <DialogField
            label="Storage Endpoint URL"
            value={form.baseUrl}
            onChange={(value) => setForm((prev) => (prev ? { ...prev, baseUrl: value } : prev))}
            placeholder="http://object-storage:9000"
          />
          <DialogCapacityField
            value={form.targetCapacityValue}
            unit={form.targetCapacityUnit}
            onValueChange={(value) =>
              setForm((prev) => (prev ? { ...prev, targetCapacityValue: value } : prev))
            }
            onUnitChange={(unit) =>
              setForm((prev) => (prev ? { ...prev, targetCapacityUnit: unit } : prev))
            }
          />
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
            onClick={() => void handleSave()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
