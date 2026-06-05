// Human: Account summary card — avatar, identity, role badge, and membership status.
// Agent: READS UserProfileResponse.user; RENDERS ProfileSectionCard; no mutations.

import { Shield } from "lucide-react";
import { displayNameFromEmail, formatShareDate } from "@/lib/public-share-format";
import { userInitials, userRoleLabel } from "@/lib/utils-app";
import type { UserProfileResponse } from "@/api/client";
import { ProfileDetailRow, ProfileSectionCard } from "@/components/profile/profile-ui";
import { cn } from "@/lib/utils";

type ProfileAccountSectionProps = {
  user: UserProfileResponse["user"];
};

// Human: Uppercase role chip for non-admin members — mirrors DriveProfileMenu badge copy.
// Agent: READS role string; RETURNS PRO MEMBER or custom label.
function profileRoleBadgeLabel(role: string): string {
  const label = userRoleLabel(role);
  if (label === "Member" || label === "Pro Member") return "PRO MEMBER";
  if (role === "admin") return "ADMIN";
  return label.toUpperCase();
}

/** Human: Identity block for the profile page — Pencil profile header adapted to a full-width card. */
export function ProfileAccountSection({ user }: ProfileAccountSectionProps) {
  const displayName = displayNameFromEmail(user.email);
  const initials = userInitials(user.email);
  const isAdmin = user.role === "admin";

  return (
    <ProfileSectionCard
      title="Account"
      description="Your identity and membership on this Ownly instance."
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-base font-bold text-white"
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-[#1A1A1A]">{displayName}</p>
            <p className="truncate text-sm text-[#666666]">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isAdmin ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-0.5 text-[10px] font-bold text-[#10B981]">
                  <Shield className="size-2.5 shrink-0" aria-hidden />
                  Admin
                </span>
              ) : (
                <span className="inline-flex rounded-md bg-[#DBEAFE] px-2 py-0.5 text-[9px] font-bold tracking-wide text-[#2563EB]">
                  {profileRoleBadgeLabel(user.role)}
                </span>
              )}
              <span
                className={cn(
                  "text-[11px] font-medium",
                  user.enabled ? "text-[#10B981]" : "text-[#EF4444]",
                )}
              >
                {user.enabled ? "• Active" : "• Pending activation"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-[#E5E7EB] pt-5">
          <ProfileDetailRow label="Role" value={userRoleLabel(user.role)} />
          <ProfileDetailRow label="Member since" value={formatShareDate(user.created_at)} />
          <ProfileDetailRow label="Account ID" value={user.id} />
        </div>
      </div>
    </ProfileSectionCard>
  );
}
