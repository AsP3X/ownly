// Human: Security & Credentials card — Pencil Security Card with password fields and MFA toggle.
// Agent: CONTROLLED security draft; EMITS onChange; PARENT persists via Save All / changeOwnPassword.

import {
  ProfileCard,
  ProfileCardHeader,
  ProfileDivider,
  ProfileFieldLabel,
  ProfilePasswordInput,
} from "@/components/profile/profile-ui";
import { Switch } from "@/components/ui/switch";
import type { ProfileSecurityDraft } from "@/lib/profile-details-storage";

export type ProfileSecurityCardProps = {
  draft: ProfileSecurityDraft;
  onChange: (draft: ProfileSecurityDraft) => void;
  sectionId?: string;
};

/** Human: Password rotation row plus green MFA switch per login-signup.pen Security Card. */
export function ProfileSecurityCard({
  draft,
  onChange,
  sectionId = "settings-security",
}: ProfileSecurityCardProps) {
  const update = (patch: Partial<ProfileSecurityDraft>) => {
    onChange({ ...draft, ...patch });
  };

  return (
    <ProfileCard id={sectionId}>
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
                value={draft.currentPassword}
                onChange={(value) => update({ currentPassword: value })}
                autoComplete="current-password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <ProfileFieldLabel htmlFor="profile-new-password">New Password</ProfileFieldLabel>
              <ProfilePasswordInput
                id="profile-new-password"
                value={draft.newPassword}
                onChange={(value) => update({ newPassword: value })}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-semibold text-[#1A1A1A]">Multi-Factor Authentication (MFA)</p>
              <p className="text-xs text-[#666666]">
                Require a secure TOTP verification code from an authenticator app when logging in.
              </p>
            </div>
            <Switch
              checked={draft.mfaEnabled}
              onCheckedChange={(checked) => update({ mfaEnabled: checked })}
              className="data-checked:bg-[#10B981] data-unchecked:bg-[#E5E7EB]"
              aria-label="Toggle multi-factor authentication"
            />
          </div>
        </div>
      </div>
    </ProfileCard>
  );
}
