// Human: Shared storage node health labels — table rows and detail dialog use the same vocabulary.
// Agent: READS API status strings; RETURNS label, badge classes, and optional admin hints.

import type { LucideIcon } from "lucide-react";
import { AlertCircle, Check, RefreshCw } from "lucide-react";

/** Human: Bootstrap node id inserted when the registry is first populated from env. */
export const PRIMARY_STORAGE_NODE_ID = "node-primary";

export type StorageNodeStatusKey = "healthy" | "degraded" | "syncing" | "not_configured";

/** Human: Normalize backend/probe status into a small set of UI keys. */
export function normalizeStorageNodeStatus(status: string): StorageNodeStatusKey {
  if (status === "healthy") return "healthy";
  if (status === "syncing") return "syncing";
  if (status === "not_configured") return "not_configured";
  return "degraded";
}

const STATUS_META: Record<
  StorageNodeStatusKey,
  {
    label: string;
    badgeClass: string;
    iconClass: string;
    chipBg: string;
    chipIconClass: string;
    Icon: LucideIcon;
    hint: string | null;
  }
> = {
  healthy: {
    label: "Healthy",
    badgeClass: "bg-[#ECFDF5] text-[#10B981]",
    iconClass: "text-[#10B981]",
    chipBg: "bg-[#ECFDF5]",
    chipIconClass: "text-[#10B981]",
    Icon: Check,
    hint: null,
  },
  syncing: {
    label: "Syncing",
    badgeClass: "bg-[#EFF6FF] text-[#3B82F6]",
    iconClass: "text-[#3B82F6]",
    chipBg: "bg-[#EFF6FF]",
    chipIconClass: "text-[#3B82F6]",
    Icon: RefreshCw,
    hint: "Health probe succeeded; node reported a sync state.",
  },
  not_configured: {
    label: "Not configured",
    badgeClass: "bg-[#FEF3C7] text-[#D97706]",
    iconClass: "text-[#D97706]",
    chipBg: "bg-[#FEF3C7]",
    chipIconClass: "text-[#D97706]",
    Icon: AlertCircle,
    hint: "Object storage environment variables are missing or the API has not been restarted.",
  },
  degraded: {
    label: "Degraded",
    badgeClass: "bg-[#FEF2F2] text-[#EF4444]",
    iconClass: "text-[#EF4444]",
    chipBg: "bg-[#FEF2F2]",
    chipIconClass: "text-[#EF4444]",
    Icon: AlertCircle,
    hint: "Endpoint unreachable or /health returned a non-ok status.",
  },
};

/** Human: User-facing status label for tables, badges, and detail rows. */
export function storageNodeStatusLabel(status: string): string {
  return STATUS_META[normalizeStorageNodeStatus(status)].label;
}

/** Human: Optional tooltip/title copy when a node needs admin attention. */
export function storageNodeStatusHint(status: string): string | null {
  return STATUS_META[normalizeStorageNodeStatus(status)].hint;
}

/** Human: Tailwind classes and icon for a node status pill or row chip. */
export function storageNodeStatusMeta(status: string) {
  return STATUS_META[normalizeStorageNodeStatus(status)];
}

/** Human: Primary pill for the env-bootstrapped node row. */
export function isPrimaryStorageNode(nodeId: string): boolean {
  return nodeId === PRIMARY_STORAGE_NODE_ID;
}
