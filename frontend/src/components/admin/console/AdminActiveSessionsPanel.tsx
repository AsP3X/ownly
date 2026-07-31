// Human: Active Sessions sub-panel — login-signup.pencil frame W5NNq inside Edit User flow.
// Agent: CALLS fetchAdminUserSessions/revoke* APIs; RETURNS to edit view via onBack.

import { useCallback, useState } from "react";
import { ArrowLeft, Info, Laptop, Loader2, Monitor, Smartphone } from "lucide-react";
import {
  fetchAdminUserSessions,
  getErrorMessage,
  revokeAdminUserSession,
  revokeOtherAdminUserSessions,
  type AdminUserRow,
} from "@/api/client";
import { useAdminQuery } from "@/hooks/useAdminQuery";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetchAdminUserSessions(user.id);
    return res.sessions;
  }, [user.id]);

  const { data: sessions, loading, error: loadError, reload } = useAdminQuery(loadSessions);
  const error = actionError ?? loadError;

  async function handleRevoke(sessionId: string) {
    setBusyId(sessionId);
    setActionError(null);
    try {
      await revokeAdminUserSession(user.id, sessionId);
      await reload(true);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevokeOthers() {
    setRevokingOthers(true);
    setActionError(null);
    try {
      await revokeOtherAdminUserSessions(user.id);
      await reload(true);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setRevokingOthers(false);
    }
  }

  const sessionRows = sessions ?? [];

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 pr-2">
          <h2 className="text-lg font-semibold text-ink">Active Sessions</h2>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
            aria-label="Back to edit user"
          >
            <ArrowLeft className="size-[18px]" aria-hidden />
          </button>
        </div>
        <p className="text-[13px] text-ink-muted">
          Manage active authorization tokens for {userDisplayName(user.email)}
        </p>
      </div>

      <AdminEditUserDivider />

      <div className="flex flex-col gap-4">
        <div className="flex gap-2.5 rounded-lg border border-brand-weak bg-brand-weak p-3">
          <Info className="size-4 shrink-0 text-brand" aria-hidden />
          <p className="text-xs leading-relaxed text-brand">
            Revoking a session ends API access for that sign-in immediately. The user must log in
            again to get a new token. Sessions created before this update require a fresh login
            before revoke can take effect.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-muted">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Loading sessions…
          </div>
        ) : null}

        {!loading && sessionRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">
            No sign-in sessions recorded yet. Sessions appear after the user logs in.
          </p>
        ) : null}

        {!loading ? (
          <div className="flex flex-col gap-2.5">
            {sessionRows.map((session) => {
              const Icon = sessionIcon(session.device_label);
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-edge bg-panel p-3.5"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="size-4 shrink-0 text-ink" aria-hidden />
                      <span className="text-[13px] font-semibold text-ink">
                        {session.device_label}
                      </span>
                      {session.is_current ? (
                        <span className="rounded-full bg-ok-weak px-1.5 py-0.5 text-[10px] font-medium text-ok">
                          Current
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-ink-muted">{session.location_label}</p>
                    <p className="text-[11px] text-ink-faint">
                      {session.created_line} • {session.activity_line}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void handleRevoke(session.id)}
                    className="shrink-0 rounded-lg border border-danger-weak bg-panel px-3.5 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger-weak disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === session.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>

      <AdminEditUserDivider />

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void handleRevokeOthers()}
          disabled={revokingOthers || loading || sessionRows.length <= 1}
          className="rounded-lg border border-danger/40 bg-danger-weak px-4 py-2.5 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-weak disabled:cursor-not-allowed disabled:opacity-50"
        >
          {revokingOthers ? "Revoking…" : "Revoke All Other Sessions"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-brand px-5 py-2.5 text-[13px] font-medium text-brand-on transition-colors hover:bg-brand-hover"
        >
          Done
        </button>
      </div>
    </div>
  );
}
