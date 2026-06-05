// Human: Preferences anchor card — completes Pencil nav row without a dedicated right-column frame.
// Agent: RENDERS notification toggles locally; WRITES prefs to localStorage on save from parent.

import {
  ProfileCard,
  ProfileCardHeader,
  ProfileDivider,
} from "@/components/profile/profile-ui";
import { Switch } from "@/components/ui/switch";
import type { ProfilePreferences } from "@/lib/profile-details-storage";

export type ProfilePreferencesCardProps = {
  preferences: ProfilePreferences;
  onChange: (preferences: ProfilePreferences) => void;
};

/** Human: Notification preference switches — scroll target for Preferences nav item. */
export function ProfilePreferencesCard({ preferences, onChange }: ProfilePreferencesCardProps) {
  return (
    <ProfileCard id="profile-preferences">
      <div className="flex flex-col gap-4">
        <ProfileCardHeader
          title="Preferences"
          description="Control email notifications and security alerts for your account."
        />
        <ProfileDivider />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]">Email notifications</p>
              <p className="text-xs text-[#666666]">Receive updates about shares and storage usage.</p>
            </div>
            <Switch
              checked={preferences.emailNotifications}
              onCheckedChange={(checked) =>
                onChange({ ...preferences, emailNotifications: checked })
              }
              className="data-checked:bg-[#2563EB] data-unchecked:bg-[#E5E7EB]"
              aria-label="Toggle email notifications"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]">Security alerts</p>
              <p className="text-xs text-[#666666]">Get notified about new sign-ins and password changes.</p>
            </div>
            <Switch
              checked={preferences.securityAlerts}
              onCheckedChange={(checked) =>
                onChange({ ...preferences, securityAlerts: checked })
              }
              className="data-checked:bg-[#2563EB] data-unchecked:bg-[#E5E7EB]"
              aria-label="Toggle security alerts"
            />
          </div>
        </div>
      </div>
    </ProfileCard>
  );
}
