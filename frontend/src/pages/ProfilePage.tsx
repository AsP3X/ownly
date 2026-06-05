// Human: Signed-in user profile — account summary and storage usage (security lives in Settings later).
// Agent: CALLS fetchUserProfile + fetchDashboard; RENDERS drive shell; route /profile.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fetchDashboard, fetchUserProfile, getErrorMessage } from "@/api/client";
import { DriveDesktopTopbar } from "@/components/drive/DriveDesktopTopbar";
import { DriveSidebar, type DriveNavId } from "@/components/drive/DriveSidebar";
import { ProfileAccountSection } from "@/components/profile/ProfileAccountSection";
import { ProfileStorageSection } from "@/components/profile/ProfileStorageSection";
import {
  ProfilePageHeader,
  profileContentClassName,
} from "@/components/profile/profile-ui";
import { useAuth } from "@/hooks/useAuth";
import { buildDriveSearchParams } from "@/lib/app-location-state";
import { displayNameFromEmail } from "@/lib/public-share-format";
import { userInitials, userRoleLabel } from "@/lib/utils-app";

/** Human: Authenticated profile route — explorer layout with drive sidebar and account panels. */
export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof fetchUserProfile>> | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(1);

  const displayName = useMemo(
    () => (user?.email ? displayNameFromEmail(user.email) : "Account"),
    [user],
  );
  const roleLabel = useMemo(() => userRoleLabel(user?.role), [user]);
  const initials = userInitials(user?.email);

  // Human: Load profile payload and sidebar quota on mount.
  // Agent: GET /me/profile + /dashboard; SETS profile + storage widget bytes.
  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [profileRes, dashboardRes] = await Promise.all([
        fetchUserProfile(),
        fetchDashboard(),
      ]);
      setProfile(profileRes);
      setUsedBytes(dashboardRes.used_bytes);
      setQuotaBytes(dashboardRes.quota_bytes);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial profile fetch on mount
    void loadProfile();
  }, [loadProfile]);

  // Human: Sidebar nav returns to the drive with the same view query keys as DrivePage.
  // Agent: NAVIGATE /?view=… via buildDriveSearchParams.
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

  const handleBackToDrive = useCallback(() => {
    navigate("/");
  }, [navigate]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#F7F8FA] text-[#1A1A1A]">
      {/* Human: Compact mobile title bar — profile is not a drive nav view, so skip MobileDriveHeader. */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-[#E5E7EB] bg-[#F7F8FA]/95 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBackToDrive}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[#666666] transition-colors hover:bg-white"
            aria-label="Back to drive"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-[#888888]">Account</p>
            <h1 className="truncate text-lg font-semibold text-[#1A1A1A]">My Profile</h1>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
        <DriveSidebar
          activeNav="home"
          usedBytes={usedBytes}
          quotaBytes={quotaBytes}
          onNavChange={handleNavChange}
        />

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 px-4 pt-4 lg:px-10 lg:pt-6">
            <DriveDesktopTopbar
              displayName={displayName}
              roleLabel={roleLabel}
              initials={initials}
              email={user?.email}
              isAdmin={user?.role === "admin"}
              statusText="My profile • Secure encrypted session"
              onSignOut={logout}
              className="hidden lg:flex"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 lg:px-12 lg:pb-12">
            <div className={profileContentClassName}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <ProfilePageHeader
                  title="My Profile"
                  description="View your account details and storage usage."
                />
                <button
                  type="button"
                  onClick={handleBackToDrive}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA]"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  Back to drive
                </button>
              </div>

              {loading ? (
                <p className="text-sm text-[#666666]">Loading profile…</p>
              ) : null}
              {error ? <p className="text-sm text-[#EF4444]">{error}</p> : null}

              {profile ? (
                <div className="flex max-w-2xl flex-col gap-6">
                  <ProfileAccountSection user={profile.user} />
                  <ProfileStorageSection storage={profile.storage} />
                </div>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
