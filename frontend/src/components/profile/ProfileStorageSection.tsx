// Human: Storage usage card — quota bar and file count for the signed-in library.
// Agent: READS UserProfileResponse.storage; RENDERS progress bar; no API calls.

import type { UserProfileResponse } from "@/api/client";
import { ProfileDetailRow, ProfileSectionCard } from "@/components/profile/profile-ui";
import { formatBytes } from "@/lib/utils-app";

type ProfileStorageSectionProps = {
  storage: UserProfileResponse["storage"];
};

/** Human: Library quota summary — mirrors DriveSidebar storage widget at profile scale. */
export function ProfileStorageSection({ storage }: ProfileStorageSectionProps) {
  const ratio = storage.quota_bytes > 0 ? storage.used_bytes / storage.quota_bytes : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const fillWidth = storage.used_bytes > 0 ? Math.max(percent, 2) : 0;

  return (
    <ProfileSectionCard
      title="Storage"
      description={`Your personal library on ${storage.instance_name}.`}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-bold text-[#1A1A1A]">
            {formatBytes(storage.used_bytes)}{" "}
            <span className="text-base font-medium text-[#666666]">
              of {formatBytes(storage.quota_bytes)}
            </span>
          </p>
          <div
            className="h-2 w-full overflow-hidden rounded-sm bg-[#E5E7EB]"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Storage used"
          >
            <div
              className="h-full rounded-sm bg-[#2563EB] transition-[width] duration-300 ease-out"
              style={{ width: `${fillWidth}%` }}
            />
          </div>
          <p className="text-xs text-[#888888]">{percent}% of your quota used</p>
        </div>

        <div className="flex flex-col gap-4 border-t border-[#E5E7EB] pt-5">
          <ProfileDetailRow
            label="Files in library"
            value={storage.file_count.toLocaleString()}
          />
          <ProfileDetailRow label="Quota" value={formatBytes(storage.quota_bytes)} />
        </div>
      </div>
    </ProfileSectionCard>
  );
}
