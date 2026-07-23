// Human: Authorized Sessions card — server-backed device rows with revoke actions.
// Agent: READS sessions from /me/sessions; EMITS onRevoke for non-current rows only.

import { Laptop, Monitor, Smartphone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AdminUserSessionRow } from "@/api/client";
import {
  ProfileCard,
  ProfileCardHeader,
  ProfileDivider,
} from "@/components/profile/profile-ui";

type ProfileSessionDeviceType = "laptop" | "smartphone" | "monitor";

const DEVICE_ICONS: Record<ProfileSessionDeviceType, LucideIcon> = {
  laptop: Laptop,
  smartphone: Smartphone,
  monitor: Monitor,
};

export type ProfileSessionsCardProps = {
  sessions: AdminUserSessionRow[];
  onRevoke: (sessionId: string) => void;
  revokingId?: string | null;
  loading?: boolean;
  error?: string;
  sectionId?: string;
};

// Human: Map server device_label to the Pencil session icon bucket.
// Agent: PURE; USED only for icon choice.
function deviceTypeFromLabel(deviceLabel: string): ProfileSessionDeviceType {
  const lower = deviceLabel.toLowerCase();
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("android")) {
    return "smartphone";
  }
  if (lower.includes("windows") || lower.includes("linux")) {
    return "monitor";
  }
  return "laptop";
}

// Human: Prefer the device segment before " • " for the row title.
// Agent: PURE; FALLS BACK to full device_label.
function deviceNameFromLabel(deviceLabel: string): string {
  const parts = deviceLabel.split("•").map((part) => part.trim());
  return parts[0] || deviceLabel || "Signed-in device";
}

function sessionMetadataLine(session: AdminUserSessionRow): string {
  return [session.location_label, session.activity_line].filter(Boolean).join(" · ");
}

/** Human: Device icon tile — Pencil 40×40 #F7F8FA rounded-lg container. */
function SessionDeviceIcon({ deviceType }: { deviceType: ProfileSessionDeviceType }) {
  const Icon = DEVICE_ICONS[deviceType];
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#F7F8FA]">
      <Icon className="size-5 text-[#1A1A1A]" aria-hidden />
    </div>
  );
}

/** Human: One authorized session row — bordered card with optional Current Session badge or Revoke CTA. */
function SessionRow({
  deviceName,
  deviceType,
  metadata,
  isCurrent = false,
  revoking = false,
  onRevoke,
}: {
  deviceName: string;
  deviceType: ProfileSessionDeviceType;
  metadata: string;
  isCurrent?: boolean;
  revoking?: boolean;
  onRevoke?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E5E7EB] bg-white p-3">
      <div className="flex min-w-0 items-center gap-4">
        <SessionDeviceIcon deviceType={deviceType} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[#1A1A1A]">{deviceName}</p>
            {isCurrent ? (
              <span className="rounded border border-[#DBEAFE] bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#2563EB]">
                Current Session
              </span>
            ) : null}
          </div>
          <p className="text-xs text-[#666666]">{metadata}</p>
        </div>
      </div>

      {isCurrent ? (
        <span className="shrink-0 text-[13px] font-medium text-[#888888]">This Device</span>
      ) : (
        <button
          type="button"
          onClick={onRevoke}
          disabled={revoking || !onRevoke}
          className="shrink-0 rounded-lg border border-[#FEE2E2] px-3.5 py-2 text-xs font-semibold text-[#EF4444] transition-colors hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {revoking ? "Revoking…" : "Revoke"}
        </button>
      )}
    </div>
  );
}

/** Human: Authorized sessions list — server rows only (no demo devices). */
export function ProfileSessionsCard({
  sessions,
  onRevoke,
  revokingId = null,
  loading = false,
  error,
  sectionId = "settings-sessions",
}: ProfileSessionsCardProps) {
  return (
    <ProfileCard id={sectionId}>
      <div className="flex flex-col gap-4">
        <ProfileCardHeader
          title="Authorized Sessions"
          description="These are the devices and browsers currently logged into your Ownly cloud account."
        />
        <ProfileDivider />

        {error ? (
          <p className="text-sm text-[#EF4444]" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? <p className="text-sm text-[#666666]">Loading sessions…</p> : null}

        {!loading && !error && sessions.length === 0 ? (
          <p className="text-sm text-[#666666]">No active sessions found for this account.</p>
        ) : null}

        <div className="flex flex-col gap-3">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              deviceName={deviceNameFromLabel(session.device_label)}
              deviceType={deviceTypeFromLabel(session.device_label)}
              metadata={sessionMetadataLine(session)}
              isCurrent={session.is_current}
              revoking={revokingId === session.id}
              onRevoke={session.is_current ? undefined : () => onRevoke(session.id)}
            />
          ))}
        </div>
      </div>
    </ProfileCard>
  );
}
