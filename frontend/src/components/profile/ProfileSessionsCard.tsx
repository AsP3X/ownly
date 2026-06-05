// Human: Authorized sessions list — Pencil Sessions Card with current device row.
// Agent: READS browser metadata; RENDERS current session; revoke disabled without session API.

import { Laptop, Smartphone } from "lucide-react";
import {
  ProfileCard,
  ProfileCardHeader,
  ProfileDivider,
  ProfileSessionBadge,
  profileRevokeButtonClassName,
} from "@/components/profile/profile-ui";
import { cn } from "@/lib/utils";

type SessionRow = {
  id: string;
  deviceName: string;
  metadata: string;
  icon: "laptop" | "smartphone";
  current?: boolean;
};

// Human: Derive a display label for the active browser session from navigator.
// Agent: READS userAgent; RETURNS device name + browser string for metadata line.
function buildCurrentSession(): SessionRow {
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|Android/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Edge Browser"
    : /Chrome\//.test(ua)
      ? "Chrome Browser"
      : /Firefox\//.test(ua)
        ? "Firefox Browser"
        : /Safari\//.test(ua)
          ? "Safari Browser"
          : "Browser";

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");

  return {
    id: "current",
    deviceName: mobile ? "Mobile Device" : "This Device",
    metadata: `${timezone} · ${browser}`,
    icon: mobile ? "smartphone" : "laptop",
    current: true,
  };
}

function SessionIcon({ kind }: { kind: SessionRow["icon"] }) {
  const className = "size-5 text-[#1A1A1A]";
  return kind === "smartphone" ? (
    <Smartphone className={className} aria-hidden />
  ) : (
    <Laptop className={className} aria-hidden />
  );
}

/** Human: Device session rows — shows this device; remote revoke awaits backend session API. */
export function ProfileSessionsCard() {
  const sessions = [buildCurrentSession()];

  return (
    <ProfileCard id="profile-sessions">
      <div className="flex flex-col gap-4">
        <ProfileCardHeader
          title="Authorized Sessions"
          description="These are the devices and browsers currently logged into your Ownly cloud account."
        />
        <ProfileDivider />

        <div className="flex flex-col gap-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-col gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#F7F8FA]">
                  <SessionIcon kind={session.icon} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[#1A1A1A]">{session.deviceName}</p>
                    {session.current ? <ProfileSessionBadge>Current Session</ProfileSessionBadge> : null}
                  </div>
                  <p className="text-xs text-[#666666]">{session.metadata}</p>
                </div>
              </div>

              {session.current ? (
                <span className="shrink-0 text-[13px] font-medium text-[#888888]">This Device</span>
              ) : (
                <button type="button" disabled className={cn(profileRevokeButtonClassName)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </ProfileCard>
  );
}
