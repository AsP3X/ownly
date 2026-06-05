// Human: Security and credentials card — Pencil Security Card with password + MFA row.
// Agent: CONTROLLED password fields; SHOWS inline errors; MFA toggle is visual-only until API ships.

import {
  ProfileCard,
  ProfileCardHeader,
  ProfileDivider,
  ProfileFieldLabel,
  ProfilePasswordInput,
} from "@/components/profile/profile-ui";
import { Switch } from "@/components/ui/switch";

export type ProfileSecurityCardProps = {
  currentPassword: string;
  newPassword: string;
  mfaEnabled: boolean;
  error: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onMfaEnabledChange: (enabled: boolean) => void;
};

/** Human: Password rotation inputs and MFA switch per login-signup.pen security panel. */
export function ProfileSecurityCard({
  currentPassword,
  newPassword,
  mfaEnabled,
  error,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onMfaEnabledChange,
}: ProfileSecurityCardProps) {
  return (
    <ProfileCard id="profile-security">
      <div className="flex flex-col gap-4">
        <ProfileCardHeader
          title="Security & Credentials"
          description="Secure your workspace access, encryption keys, and multi-factor verification."
        />
        <ProfileDivider />

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <ProfileFieldLabel htmlFor="profile-current-password">Current Password</ProfileFieldLabel>
              <ProfilePasswordInput
                id="profile-current-password"
                value={currentPassword}
                onChange={onCurrentPasswordChange}
                autoComplete="current-password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <ProfileFieldLabel htmlFor="profile-new-password">New Password</ProfileFieldLabel>
              <ProfilePasswordInput
                id="profile-new-password"
                value={newPassword}
                onChange={onNewPasswordChange}
                autoComplete="new-password"
              />
            </div>
          </div>

          {error ? (
            <p className="text-sm text-[#EF4444]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#1A1A1A]">
                Multi-Factor Authentication (MFA)
              </p>
              <p className="text-xs leading-relaxed text-[#666666]">
                Require a secure TOTP verification code from an authenticator app when logging in.
              </p>
            </div>
            <Switch
              checked={mfaEnabled}
              onCheckedChange={onMfaEnabledChange}
              className="data-checked:bg-[#10B981] data-unchecked:bg-[#E5E7EB]"
              aria-label="Toggle multi-factor authentication"
            />
          </div>
        </div>
      </div>
    </ProfileCard>
  );
}
