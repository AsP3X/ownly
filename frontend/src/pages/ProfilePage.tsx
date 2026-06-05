// Human: Account Settings — Pencil User Profile wireframe with drive shell.
// Agent: CALLS fetchUserProfile; RENDERS /profile; Tailwind-only chrome.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Save } from "lucide-react";
import { fetchDashboard, fetchUserProfile, getErrorMessage } from "@/api/client";
import { DriveDesktopTopbar } from "@/components/drive/DriveDesktopTopbar";
import { DriveSidebar, type DriveNavId } from "@/components/drive/DriveSidebar";
import { ProfilePersonalDetailsCard } from "@/components/profile/ProfilePersonalDetailsCard";
import { ProfilePreferencesCard } from "@/components/profile/ProfilePreferencesCard";
import { ProfileSectionNav, type ProfileSectionId } from "@/components/profile/ProfileSectionNav";
import { ProfileSummaryCard } from "@/components/profile/ProfileSummaryCard";
import { profilePrimaryButtonClassName } from "@/components/profile/profile-ui";
import { useAuth } from "@/hooks/useAuth";
import { buildDriveSearchParams } from "@/lib/app-location-state";
import {
  readPasswordChangedAt,
  readProfileDetailsDraft,
  readProfilePreferences,
  writeProfileDetailsDraft,
  writeProfilePreferences,
  type ProfileDetailsDraft,
} from "@/lib/profile-details-storage";
import { formatProfileLocationLabel } from "@/lib/profile-format";
import { displayNameFromEmail } from "@/lib/public-share-format";
import { userInitials, userRoleLabel } from "@/lib/utils-app";

/** Human: Authenticated profile route — explorer sidebar + Account Settings & Security layout. */
export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof fetchUserProfile>> | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(1);
  const [activeSection, setActiveSection] = useState<ProfileSectionId>("details");
  const [detailsDraft, setDetailsDraft] = useState<ProfileDetailsDraft>({
    fullName: "",
    jobTitle: "",
    department: "",
    bio: "",
  });
  const [preferences, setPreferences] = useState(() =>
    user?.id ? readProfilePreferences(user.id) : { emailNotifications: true, securityAlerts: true },
  );
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

      const savedDraft = readProfileDetailsDraft(profileRes.user.id);
      const derivedName = displayNameFromEmail(profileRes.user.email);
      setDetailsDraft({
        fullName: savedDraft?.fullName ?? derivedName,
        jobTitle: savedDraft?.jobTitle ?? userRoleLabel(profileRes.user.role),
        department: savedDraft?.department ?? "",
        bio: savedDraft?.bio ?? "",
      });
      setPreferences(readProfilePreferences(profileRes.user.id));
      setLastPasswordResetAt(readPasswordChangedAt(profileRes.user.id));
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial profile fetch on mount
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

  const handleSaveAll = useCallback(() => {
    if (!profile) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess("");

    try {
      writeProfileDetailsDraft(profile.user.id, detailsDraft);
      writeProfilePreferences(profile.user.id, preferences);
      setSaveSuccess("Profile changes saved.");
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [detailsDraft, preferences, profile]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#F7F8FA] text-[#1A1A1A]">
      {/* Human: Mobile page title — desktop header lives inside scroll area per Pencil layout. */}
      <header className="shrink-0 border-b border-[#E5E7EB] bg-white px-4 py-3 lg:hidden">
        <h1 className="text-lg font-bold text-[#1A1A1A]">Account Settings & Security</h1>
        <p className="text-xs text-[#666666]">Manage your personal details and preferences.</p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
        <DriveSidebar
          activeNav="home"
          settingsActive
          usedBytes={usedBytes}
          quotaBytes={quotaBytes}
          onNavChange={handleNavChange}
        />

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#F7F8FA]">
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-10 pt-4 lg:px-12 lg:pb-12 lg:pt-0">
            <DriveDesktopTopbar
              displayName={displayName}
              roleLabel={userRoleLabel(user?.role)}
              initials={initials}
              email={user?.email}
              isAdmin={user?.role === "admin"}
              statusText="Secure Profile Session Active"
              onSignOut={logout}
              className="hidden lg:flex"
            />

            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="text-2xl font-bold text-[#1A1A1A]">Account Settings & Security</h1>
                <p className="max-w-2xl text-sm text-[#666666]">
                  Manage your personal details and preferences.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveAll}
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

            {loading ? <p className="text-sm text-[#666666]">Loading profile…</p> : null}
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
                  <ProfileSectionNav activeSection={activeSection} onSelect={setActiveSection} />
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-6">
                  <ProfilePersonalDetailsCard
                    draft={detailsDraft}
                    email={profile.user.email}
                    onChange={setDetailsDraft}
                  />
                  <ProfilePreferencesCard preferences={preferences} onChange={setPreferences} />
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
