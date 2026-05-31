// Human: Setup wizard — first storage node configuration modal.
// Agent: CONTROLLED draft; CALLS testSetupStorage; RETURNS saved node fields to SetupPage on confirm.

import { useEffect, useState } from "react";
import { Loader2, Server, X } from "lucide-react";
import { getErrorMessage, testSetupStorage, type StorageCapacityUnit } from "@/api/client";
import { SetupDbStatusBanner } from "@/components/setup/SetupDbStatusBanner";
import { SetupField } from "@/components/setup/SetupField";
import { SetupNoticeBox } from "@/components/setup/SetupNoticeBox";
import { SetupOutlineButton } from "@/components/setup/SetupOutlineButton";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type SetupStorageNodeDraft = {
  nodeId: string;
  regionLabel: string;
  baseUrl: string;
  capacityValue: string;
  capacityUnit: StorageCapacityUnit;
};

const CAPACITY_UNITS: StorageCapacityUnit[] = ["MB", "GB", "TB"];

/** Human: Validate node draft before saving from the setup dialog. */
export function validateSetupStorageNodeDraft(draft: SetupStorageNodeDraft): string | null {
  if (!draft.nodeId.trim()) return "Node ID is required";
  if (!/^[a-zA-Z0-9_-]+$/.test(draft.nodeId.trim())) {
    return "Node ID may only contain letters, numbers, hyphens, and underscores";
  }
  if (!draft.regionLabel.trim()) return "Region label is required";
  if (!draft.baseUrl.trim()) return "Storage endpoint URL is required";
  if (!draft.baseUrl.trim().startsWith("http://") && !draft.baseUrl.trim().startsWith("https://")) {
    return "Storage endpoint URL must start with http:// or https://";
  }
  const capacity = Number.parseFloat(draft.capacityValue);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return "Target capacity must be a positive number";
  }
  return null;
}

/** Human: Modal for registering the first Nebular node during setup. */
export function SetupStorageNodeDialog({
  open,
  onOpenChange,
  value,
  onSave,
  onTestSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SetupStorageNodeDraft;
  onSave: (draft: SetupStorageNodeDraft) => void;
  /** Agent: Parent shows connection banner on step 3 after a successful probe. */
  onTestSuccess?: (message: string) => void;
}) {
  const [draft, setDraft] = useState<SetupStorageNodeDraft>(value);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testBanner, setTestBanner] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
      setError("");
      setTestBanner(null);
    }
  }, [open, value]);

  function updateDraft(patch: Partial<SetupStorageNodeDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setTestBanner(null);
  }

  async function handleTest() {
    setError("");
    setTestBanner(null);
    const validation = validateSetupStorageNodeDraft(draft);
    if (validation) {
      setError(validation);
      return;
    }

    setTesting(true);
    try {
      const res = await testSetupStorage(draft.baseUrl.trim());
      const latency = res.latency_ms != null ? `${res.latency_ms} ms` : "n/a";
      const nodeHint = res.node_id ? ` Node ID: ${res.node_id}.` : "";
      const message = `Object storage reachable (${latency} latency).${nodeHint}`;
      setTestBanner({ ok: true, message });
      onTestSuccess?.(message);
    } catch (err) {
      const message = `Connection failed: ${getErrorMessage(err)}`;
      setTestBanner({ ok: false, message });
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    setError("");
    const validation = validateSetupStorageNodeDraft(draft);
    if (validation) {
      setError(validation);
      return;
    }
    onSave({
      nodeId: draft.nodeId.trim(),
      regionLabel: draft.regionLabel.trim(),
      baseUrl: draft.baseUrl.trim(),
      capacityValue: draft.capacityValue.trim(),
      capacityUnit: draft.capacityUnit,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col gap-5 overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_12px_32px_-4px_#00000026] sm:max-w-[560px]"
        overlayClassName="bg-black/30"
      >
        <DialogTitle className="sr-only">Configure storage node</DialogTitle>
        <DialogDescription className="sr-only">
          Register your first Nebular OS storage node for the Ownly instance
        </DialogDescription>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#EFF6FF]">
              <Server className="size-4 text-[#2563EB]" aria-hidden />
            </div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">Configure storage node</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-8 items-center justify-center rounded-full text-[#666666] transition-colors hover:bg-[#F7F8FA]"
            aria-label="Close dialog"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />

        <SetupNoticeBox>
          In Docker Compose use{" "}
          <span className="font-medium text-[#1A1A1A]">http://object-storage:9000</span>. Each
          additional node is a separate standalone Nebular endpoint registered in the admin console.
        </SetupNoticeBox>

        {testBanner ? (
          <SetupDbStatusBanner variant={testBanner.ok ? "success" : "error"} message={testBanner.message} />
        ) : null}

        <SetupField
          label="Node ID"
          placeholder="node-primary"
          value={draft.nodeId}
          onChange={(e) => updateDraft({ nodeId: e.target.value })}
        />
        <SetupField
          label="Region label"
          placeholder="US East"
          value={draft.regionLabel}
          onChange={(e) => updateDraft({ regionLabel: e.target.value })}
        />
        <SetupField
          label="Storage endpoint URL"
          placeholder="http://object-storage:9000"
          value={draft.baseUrl}
          onChange={(e) => updateDraft({ baseUrl: e.target.value })}
        />

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <SetupField
            label="Target capacity"
            type="number"
            min={1}
            value={draft.capacityValue}
            onChange={(e) => updateDraft({ capacityValue: e.target.value })}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[#666666]">Unit</label>
            <select
              value={draft.capacityUnit}
              onChange={(e) => updateDraft({ capacityUnit: e.target.value as StorageCapacityUnit })}
              className="h-10 rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A]"
            >
              {CAPACITY_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SetupOutlineButton onClick={() => void handleTest()} disabled={testing}>
          {testing ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Testing…
            </>
          ) : (
            "Test storage connection"
          )}
        </SetupOutlineButton>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t border-[#E5E7EB] pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-[#1A1A1A] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#333333]"
          >
            Save node
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
