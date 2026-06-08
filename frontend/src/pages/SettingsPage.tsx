// Human: Account Settings & Security — Pencil wireframe at /settings (password, MFA, sessions).
// Agent: CALLS fetchUserProfile + changeOwnPassword; RENDERS drive shell; Tailwind-only chrome.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Save } from "lucide-react";
import {
  changeOwnPassword,
  fetchDashboard,
  fetchUserProfile,
  getErrorMessage,
} from "@/api/client";
import { DriveDesktopTopbar } from "@/components/drive/DriveDesktopTopbar";
import { DriveSidebar, type DriveNavId } from "@/components/drive/DriveSidebar";
import { ProfilePersonalDetailsCard } from "@/components/profile/ProfilePersonalDetailsCard";
import { ProfilePreferencesCard } from "@/components/profile/ProfilePreferencesCard";
import {
  ProfileSectionNav,
  type SettingsSectionId,
} from "@/components/profile/ProfileSectionNav";
import { ProfileSecurityCard } from "@/components/profile/ProfileSecurityCard";
import { ProfileSessionsCard } from "@/components/profile/ProfileSessionsCard";
import { ProfileSummaryCard } from "@/components/profile/ProfileSummaryCard";
import { profilePrimaryButtonClassName } from "@/components/profile/profile-ui";
import { useAuth } from "@/hooks/useAuth";
import { buildDriveSearchParams } from "@/lib/app-location-state";
import {
  readPasswordChangedAt,
  readProfileDetailsDraft,
  readProfileMfaEnabled,
  readProfilePreferences,
  writePasswordChangedAt,
  writeProfileDetailsDraft,
  writeProfileMfaEnabled,
  writeProfilePreferences,
  type ProfileDetailsDraft,
  type ProfileSecurityDraft,
} from "@/lib/profile-details-storage";
import { formatProfileLocationLabel } from "@/lib/profile-format";
import {
  readProfileRemoteSessions,
  writeProfileRemoteSessions,
  type ProfileSessionRow,
} from "@/lib/profile-sessions-storage";
import { displayNameFromEmail } from "@/lib/public-share-format";
import { userInitials, userRoleLabel } from "@/lib/utils-app";

/** Human: Authenticated settings route — full Account Settings & Security layout per login-signup.pen. */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof fetchUserProfile>> | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(1);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("security");
  const [detailsDraft, setDetailsDraft] = useState<ProfileDetailsDraft>({
    fullName: "",
    jobTitle: "",
    department: "",
    bio: "",
  });
  const [securityDraft, setSecurityDraft] = useState<ProfileSecurityDraft>({
    currentPassword: "",
    newPassword: "",
    mfaEnabled: true,
  });
  const [preferences, setPreferences] = useState(() =>
    user?.id ? readProfilePreferences(user.id) : { emailNotifications: true, securityAlerts: true },
  );
  const [remoteSessions, setRemoteSessions] = useState<ProfileSessionRow[]>([]);
  const [lastPasswordResetAt, setLastPasswordResetAt] = useState<string | null>(null);

  const displayName = useMemo(
    () => detailsDraft.fullName.trim() || (user?.email ? displayNameFromEmail(user.email) : "Account"),
    [detailsDraft.fullName, user],
  );
  const roleLabel = useMemo(
    () => detailsDraft.jobTitle.trim() || userRoleLabel(user?.role),
    [detailsDraft.jobTitle, user],
  );
  const initials = userInitials(user?.email);
  const locationLabel = useMemo(() => formatProfileLocationLabel(), []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [profileRes, dashboardRes] = await Promise.all([
        fetchUserProfile(),
        fetchDashboard(),
      ]);
      setProfile(profileRes);
      setUsedBytes(dashboardRes.used_bytes);
      setQuotaBytes(dashboardRes.quota_bytes);

      const userId = profileRes.user.id;
      const savedDraft = readProfileDetailsDraft(userId);
      const derivedName = displayNameFromEmail(profileRes.user.email);
      setDetailsDraft({
        fullName: savedDraft?.fullName ?? derivedName,
        jobTitle: savedDraft?.jobTitle ?? userRoleLabel(profileRes.user.role),
        department: savedDraft?.department ?? "",
        bio: savedDraft?.bio ?? "",
      });
      setPreferences(readProfilePreferences(userId));
      setSecurityDraft({
        currentPassword: "",
        newPassword: "",
        mfaEnabled: readProfileMfaEnabled(userId),
      });
      setRemoteSessions(readProfileRemoteSessions(userId));
      setLastPasswordResetAt(readPasswordChangedAt(userId));
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial settings fetch on mount
    void loadProfile();
  }, [loadProfile]);

  const handleNavChange = useCallback(
    (nav: DriveNavId) => {
      const params = buildDriveSearchParams({
        view: nav,
        folderIds: [],
        query: "",
        typeFilter: "all",
      });
      const qs = params.toString();
      navigate(qs ? `/?${qs}` : "/");
    },
    [navigate],
  );

  const handleRevokeSession = useCallback(
    (sessionId: string) => {
      if (!profile) return;
      const next = remoteSessions.filter((session) => session.id !== sessionId);
      setRemoteSessions(next);
      writeProfileRemoteSessions(profile.user.id, next);
    },
    [profile, remoteSessions],
  );

  const handleSaveAll = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess("");

    try {
      writeProfileDetailsDraft(profile.user.id, detailsDraft);
      writeProfilePreferences(profile.user.id, preferences);
      writeProfileMfaEnabled(profile.user.id, securityDraft.mfaEnabled);

      const wantsPasswordChange =
        securityDraft.currentPassword.length > 0 || securityDraft.newPassword.length > 0;

      if (wantsPasswordChange) {
        if (!securityDraft.currentPassword || !securityDraft.newPassword) {
          throw new Error("Enter both current and new password to update your credentials.");
        }
        await changeOwnPassword(securityDraft.currentPassword, securityDraft.newPassword);
        const changedAt = new Date().toISOString();
        writePasswordChangedAt(profile.user.id, changedAt);
        setLastPasswordResetAt(changedAt);
        setSecurityDraft((current) => ({
          ...current,
          currentPassword: "",
          newPassword: "",
        }));
      }

      setSaveSuccess("Settings saved.");
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [detailsDraft, preferences, profile, securityDraft]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#F7F8FA] text-[#1A1A1A]">
      <header className="shrink-0 border-b border-[#E5E7EB] bg-white px-4 py-3 lg:hidden">
        <h1 className="text-lg font-bold text-[#1A1A1A]">Account Settings & Security</h1>
        <p className="text-xs text-[#666666]">
          Manage your personal details, secure keys, active sessions, and preferences.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
        <DriveSidebar
          activeNav="home"
          settingsActive
          usedBytes={usedBytes}
          quotaBytes={quotaBytes}
          onNavChange={handleNavChange}
          onSettingsClick={() => navigate("/settings")}
        />

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#F7F8FA]">
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-10 pt-4 lg:px-12 lg:pb-12 lg:pt-0">
            <DriveDesktopTopbar
              displayName={displayName}
              roleLabel={userRoleLabel(user?.role)}
              initials={initials}
              email={user?.email}
              isAdmin={isAdmin}
              statusText="Secure Profile Session Active"
              onSignOut={logout}
              className="hidden lg:flex"
            />

            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="text-2xl font-bold text-[#1A1A1A]">Account Settings & Security</h1>
                <p className="max-w-2xl text-sm text-[#666666]">
                  Manage your personal details, secure keys, active sessions, and preferences.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveAll()}
                disabled={saving || loading || !profile}
                className={profilePrimaryButtonClassName}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                Save All Changes
              </button>
            </div>

            {loading ? <p className="text-sm text-[#666666]">Loading settings…</p> : null}
            {loadError ? (
              <p className="text-sm text-[#EF4444]" role="alert">
                {loadError}
              </p>
            ) : null}
            {saveError ? (
              <p className="text-sm text-[#EF4444]" role="alert">
                {saveError}
              </p>
            ) : null}
            {saveSuccess ? (
              <p className="text-sm text-[#10B981]" role="status">
                {saveSuccess}
              </p>
            ) : null}

            {profile ? (
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                <div className="flex w-full shrink-0 flex-col gap-6 xl:w-[360px]">
                  <ProfileSummaryCard
                    initials={initials}
                    displayName={displayName}
                    roleLabel={roleLabel}
                    locationLabel={locationLabel}
                    user={profile.user}
                    storage={profile.storage}
                    lastPasswordResetAt={lastPasswordResetAt}
                  />
                  <ProfileSectionNav
                    variant="settings"
                    activeSection={activeSection}
                    onSelect={setActiveSection}
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-6">
                  <ProfilePersonalDetailsCard
                    draft={detailsDraft}
                    email={profile.user.email}
                    onChange={setDetailsDraft}
                    sectionId="settings-profile-details"
                  />
                  <ProfileSecurityCard draft={securityDraft} onChange={setSecurityDraft} />
                  <ProfileSessionsCard
                    remoteSessions={remoteSessions}
                    onRevoke={handleRevokeSession}
                  />
                  <ProfilePreferencesCard
                    preferences={preferences}
                    onChange={setPreferences}
                    sectionId="settings-preferences"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
