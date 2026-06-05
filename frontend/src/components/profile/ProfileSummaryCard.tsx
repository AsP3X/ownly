// Human: Left-column profile summary — Pencil Profile Summary Card with avatar and stats.
// Agent: READS user + storage props; RENDERS static summary rows; no mutations.

import { Camera, MapPin } from "lucide-react";
import type { UserProfileResponse } from "@/api/client";
import { ProfileCard, ProfileDivider, ProfileStatRow } from "@/components/profile/profile-ui";
import { formatProfileDaysAgo } from "@/lib/profile-format";
import { formatBytes, userRoleLabel } from "@/lib/utils-app";

export type ProfileSummaryCardProps = {
  initials: string;
  displayName: string;
  roleLabel: string;
  locationLabel: string;
  user: UserProfileResponse["user"];
  storage: UserProfileResponse["storage"];
  lastPasswordResetAt: string | null;
};

/** Human: Avatar, identity, and account stats column per login-signup.pen left rail. */
export function ProfileSummaryCard({
  initials,
  displayName,
  roleLabel,
  locationLabel,
  user,
  storage,
  lastPasswordResetAt,
}: ProfileSummaryCardProps) {
  const storageLabel = `${formatBytes(storage.used_bytes)} of ${formatBytes(storage.quota_bytes)}`;

  return (
    <ProfileCard>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex size-20 items-center justify-center rounded-full bg-[#2563EB] text-[28px] font-bold text-white"
            aria-hidden
          >
            {initials}
          </div>
          <button
            type="button"
            disabled
            title="Avatar uploads are not available yet"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-1.5 text-xs font-medium text-[#666666]"
          >
            <Camera className="size-3.5" aria-hidden />
            Change Avatar
          </button>
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-lg font-bold text-[#1A1A1A]">{displayName}</p>
          <p className="text-[13px] text-[#666666]">{roleLabel}</p>
          <div className="flex items-center gap-1 text-xs text-[#888888]">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span>{locationLabel}</span>
          </div>
        </div>

        <ProfileDivider />

        <div className="flex flex-col gap-3">
          <ProfileStatRow label="Account Level" value={userRoleLabel(user.role)} />
          <ProfileStatRow label="Storage Usage" value={storageLabel} />
          <ProfileStatRow
            label="Encryption Keys"
            value="AES-256 Active"
            valueClassName="text-[#10B981]"
          />
          <ProfileStatRow
            label="Last Password Reset"
            value={formatProfileDaysAgo(lastPasswordResetAt)}
          />
        </div>
      </div>
    </ProfileCard>
  );
}
