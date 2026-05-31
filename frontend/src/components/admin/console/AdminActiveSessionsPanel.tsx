// Human: Active Sessions sub-panel — login-signup.pencil frame W5NNq inside Edit User flow.
// Agent: CALLS fetchAdminUserSessions/revoke* APIs; RETURNS to edit view via onBack.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Info, Laptop, Loader2, Monitor, Smartphone } from "lucide-react";
import {
  fetchAdminUserSessions,
  getErrorMessage,
  revokeAdminUserSession,
  revokeOtherAdminUserSessions,
  type AdminUserRow,
  type AdminUserSessionRow,
} from "@/api/client";
import { AdminEditUserDivider } from "@/components/admin/console/AdminEditUserDialogLayout";
import { userDisplayName } from "@/lib/utils-app";

function sessionIcon(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("iphone") || lower.includes("android")) {
    return Smartphone;
  }
  if (lower.includes("windows") || lower.includes("macos")) {
    return lower.includes("windows") ? Monitor : Laptop;
  }
  return Monitor;
}

/** Human: Sessions list with revoke actions — stacked inside the edit-user modal. */
export function AdminActiveSessionsPanel({
  user,
  onBack,
}: {
  user: AdminUserRow;
  onBack: () => void;
}) {
  const [sessions, setSessions] = useState<AdminUserSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminUserSessions(user.id);
      setSessions(res.sessions);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load sessions when panel opens
    void loadSessions();
  }, [loadSessions]);

  async function handleRevoke(sessionId: string) {
    setBusyId(sessionId);
    setError(null);
    try {
      await revokeAdminUserSession(user.id, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      await loadSessions();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevokeOthers() {
    setRevokingOthers(true);
    setError(null);
    try {
      await revokeOtherAdminUserSessions(user.id);
      await loadSessions();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRevokingOthers(false);
    }
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 pr-2">
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Active Sessions</h2>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#666666] transition-colors hover:text-[#1A1A1A]"
            aria-label="Back to edit user"
          >
            <ArrowLeft className="size-[18px]" aria-hidden />
          </button>
        </div>
        <p className="text-[13px] text-[#666666]">
          Manage active authorization tokens for {userDisplayName(user.email)}
        </p>
      </div>

      <AdminEditUserDivider />

      <div className="flex flex-col gap-4">
        <div className="flex gap-2.5 rounded-lg border border-[#DBEAFE] bg-[#EFF6FF] p-3">
          <Info className="size-4 shrink-0 text-[#2563EB]" aria-hidden />
          <p className="text-xs leading-relaxed text-[#2563EB]">
            Revoking a session ends API access for that sign-in immediately. The user must log in
            again to get a new token. Sessions created before this update require a fresh login
            before revoke can take effect.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#666666]">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Loading sessions…
          </div>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#666666]">
            No sign-in sessions recorded yet. Sessions appear after the user logs in.
          </p>
        ) : null}

        {!loading ? (
          <div className="flex flex-col gap-2.5">
            {sessions.map((session) => {
              const Icon = sessionIcon(session.device_label);
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-[#E5E7EB] bg-white p-3.5"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="size-4 shrink-0 text-[#1A1A1A]" aria-hidden />
                      <span className="text-[13px] font-semibold text-[#1A1A1A]">
                        {session.device_label}
                      </span>
                      {session.is_current ? (
                        <span className="rounded-full bg-[#ECFDF5] px-1.5 py-0.5 text-[10px] font-medium text-[#059669]">
                          Current
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-[#666666]">{session.location_label}</p>
                    <p className="text-[11px] text-[#888888]">
                      {session.created_line} • {session.activity_line}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void handleRevoke(session.id)}
                    className="shrink-0 rounded-lg border border-[#FEE2E2] bg-white px-3.5 py-2 text-xs font-medium text-[#EF4444] transition-colors hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === session.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      <AdminEditUserDivider />

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void handleRevokeOthers()}
          disabled={revokingOthers || loading || sessions.length <= 1}
          className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2.5 text-[13px] font-semibold text-[#DC2626] transition-colors hover:bg-[#FEE2E2] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {revokingOthers ? "Revoking…" : "Revoke All Other Sessions"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-[#2563EB] px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#1D4ED8]"
        >
          Done
        </button>
      </div>
    </div>
  );
}
