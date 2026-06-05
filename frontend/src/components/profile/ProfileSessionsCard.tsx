// Human: Authorized Sessions card — Pencil Sessions Card with device rows and revoke actions.
// Agent: READS current device + stored remote rows; EMITS onRevoke; no server revoke until /me/sessions.

import { Laptop, Monitor, Smartphone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ProfileCard,
  ProfileCardHeader,
  ProfileDivider,
} from "@/components/profile/profile-ui";
import {
  detectCurrentSessionBrowserLabel,
  detectCurrentSessionDeviceName,
  detectCurrentSessionDeviceType,
  type ProfileSessionDeviceType,
  type ProfileSessionRow,
} from "@/lib/profile-sessions-storage";
import { formatProfileSessionLocationLabel } from "@/lib/profile-format";

const DEVICE_ICONS: Record<ProfileSessionDeviceType, LucideIcon> = {
  laptop: Laptop,
  smartphone: Smartphone,
  monitor: Monitor,
};

export type ProfileSessionsCardProps = {
  remoteSessions: ProfileSessionRow[];
  onRevoke: (sessionId: string) => void;
  sectionId?: string;
};

function sessionMetadataLine(session: ProfileSessionRow): string {
  const parts = [session.location, session.ip, session.client];
  if (session.lastActiveLabel) parts.push(session.lastActiveLabel);
  return parts.join(" · ");
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
  onRevoke,
}: {
  deviceName: string;
  deviceType: ProfileSessionDeviceType;
  metadata: string;
  isCurrent?: boolean;
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
          className="shrink-0 rounded-lg border border-[#FEE2E2] px-3.5 py-2 text-xs font-semibold text-[#EF4444] transition-colors hover:bg-[#FEF2F2]"
        >
          Revoke
        </button>
      )}
    </div>
  );
}

/** Human: Authorized sessions list — current browser row plus revocable remote devices. */
export function ProfileSessionsCard({
  remoteSessions,
  onRevoke,
  sectionId = "settings-sessions",
}: ProfileSessionsCardProps) {
  const currentDeviceName = detectCurrentSessionDeviceName();
  const currentDeviceType = detectCurrentSessionDeviceType();
  const currentMetadata = [
    formatProfileSessionLocationLabel(),
    "192.168.1.145",
    detectCurrentSessionBrowserLabel(),
  ].join(" · ");

  return (
    <ProfileCard id={sectionId}>
      <div className="flex flex-col gap-4">
        <ProfileCardHeader
          title="Authorized Sessions"
          description="These are the devices and browsers currently logged into your Ownly cloud account."
        />
        <ProfileDivider />

        <div className="flex flex-col gap-3">
          <SessionRow
            deviceName={currentDeviceName}
            deviceType={currentDeviceType}
            metadata={currentMetadata}
            isCurrent
          />

          {remoteSessions.map((session) => (
            <SessionRow
              key={session.id}
              deviceName={session.deviceName}
              deviceType={session.deviceType}
              metadata={sessionMetadataLine(session)}
              onRevoke={() => onRevoke(session.id)}
            />
          ))}
        </div>
      </div>
    </ProfileCard>
  );
}
