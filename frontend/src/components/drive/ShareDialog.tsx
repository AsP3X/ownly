// Human: Modal to create, copy, or revoke a public link for one file or folder.
// Agent: CALLS fetchResourceShares/createPublicShare/updatePublicShare/inviteUserShare; WRITES clipboard.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Calendar,
  Check,
  Copy,
  Globe,
  Link2,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  Trash2,
  UserMinus,
  X,
} from "lucide-react";
import {
  createPublicShare,
  fetchResourceShares,
  getErrorMessage,
  inviteUserShare,
  publicSharePageUrl,
  revokePublicShare,
  revokeUserShare,
  updatePublicShare,
  type ShareLink,
  type UserShare,
} from "@/api/client";
import { copyTextToClipboard } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export type ShareTarget =
  | { resource_type: "file"; resource_id: string; name: string }
  | { resource_type: "folder"; resource_id: string; name: string };

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget | null;
  onShareChanged?: () => void;
};

type ShareDialogTab = "invite" | "public-link";

type ShareSettingsDraft = {
  requirePassword: boolean;
  password: string;
  expirationEnabled: boolean;
  expiresAt: string;
  blockDownload: boolean;
};

// Human: Default expiration date ~30 days out for new share links.
// Agent: RETURNS yyyy-mm-dd string for native date input.
function defaultExpirationDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

// Human: Hydrate editable protection fields from an API share row.
// Agent: MAPS ShareLink → ShareSettingsDraft for controlled form inputs.
function settingsFromShare(share: ShareLink | null): ShareSettingsDraft {
  return {
    requirePassword: share?.requires_password ?? false,
    password: "",
    expirationEnabled: Boolean(share?.expires_at),
    expiresAt: share?.expires_at?.slice(0, 10) ?? defaultExpirationDate(),
    blockDownload: share?.block_download ?? false,
  };
}

// Human: Tab row matching Pencil share dialog — active tab gets accent underline.
// Agent: RENDERS button tabs; CALLS onSelect; PUBLIC LINK tab drives link UI.
function ShareDialogTabs({
  activeTab,
  onSelect,
}: {
  activeTab: ShareDialogTab;
  onSelect: (tab: ShareDialogTab) => void;
}) {
  return (
    <div
      className="flex gap-6 border-b border-[#E5E7EB]"
      role="tablist"
      aria-label="Share options"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "invite"}
        className={cn(
          "flex flex-col gap-2.5 px-1 pb-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30",
          activeTab === "invite"
            ? "font-semibold text-[#2563EB]"
            : "font-normal text-[#666666] hover:text-[#1A1A1A]",
        )}
        onClick={() => onSelect("invite")}
      >
        <span>Invite Users &amp; Groups</span>
        <span
          className={cn(
            "h-0.5 w-full rounded-full",
            activeTab === "invite" ? "bg-[#2563EB]" : "bg-transparent",
          )}
          aria-hidden
        />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "public-link"}
        className={cn(
          "flex flex-col gap-2.5 px-1 pb-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30",
          activeTab === "public-link"
            ? "font-semibold text-[#2563EB]"
            : "font-normal text-[#666666] hover:text-[#1A1A1A]",
        )}
        onClick={() => onSelect("public-link")}
      >
        <span>Public Link Sharing</span>
        <span
          className={cn(
            "h-0.5 w-full rounded-full",
            activeTab === "public-link" ? "bg-[#2563EB]" : "bg-transparent",
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}

// Human: One protection row in the Pencil security block — icon, copy, and toggle on the right.
// Agent: RENDERS Switch + optional nested field; CALLS onCheckedChange from parent draft state.
function ShareProtectionRow({
  icon: Icon,
  title,
  subtitle,
  checked,
  disabled = false,
  onCheckedChange,
  children,
}: {
  icon: typeof Lock;
  title: string;
  subtitle: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon className="size-4 shrink-0 text-[#666666]" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[13px] font-semibold text-[#1A1A1A]">{title}</p>
            <p className="text-[11px] leading-snug text-[#888888]">{subtitle}</p>
          </div>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          className="data-checked:bg-[#2563EB] data-unchecked:bg-[#E5E7EB]"
          aria-label={title}
        />
      </div>
      {children}
    </div>
  );
}

export function ShareDialog({ open, onOpenChange, target, onShareChanged }: ShareDialogProps) {
  const [share, setShare] = useState<ShareLink | null>(null);
  const [userShares, setUserShares] = useState<UserShare[]>([]);
  const [pageUrl, setPageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<ShareDialogTab>("public-link");
  const [settings, setSettings] = useState<ShareSettingsDraft>(settingsFromShare(null));
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const applyShareState = useCallback((nextShare: ShareLink | null) => {
    setShare(nextShare);
    setPageUrl(nextShare ? publicSharePageUrl(nextShare.token) : "");
    setSettings(settingsFromShare(nextShare));
  }, []);

  // Human: Load public link + invited users whenever the dialog opens for a target.
  // Agent: GET /shares/resource; DOES NOT auto-create public links until public tab needs one.
  const loadResourceShares = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const res =
        target.resource_type === "file"
          ? await fetchResourceShares({ file_id: target.resource_id })
          : await fetchResourceShares({ folder_id: target.resource_id });
      applyShareState(res.public_share);
      setUserShares(res.user_shares);
    } catch (e) {
      applyShareState(null);
      setUserShares([]);
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [target, applyShareState]);

  // Human: Create a public link the first time the owner opens the Public Link tab.
  // Agent: POST /shares; SETS share + pageUrl; EMITS onShareChanged for drive indicators.
  const ensurePublicLink = useCallback(async () => {
    if (!target || share || creatingLink) return;
    setCreatingLink(true);
    setError("");
    try {
      const created = await createPublicShare({
        resource_type: target.resource_type,
        resource_id: target.resource_id,
      });
      applyShareState(created.share);
      onShareChanged?.();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setCreatingLink(false);
    }
  }, [target, share, creatingLink, applyShareState, onShareChanged]);

  useEffect(() => {
    if (!open || !target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch when controlled open flips true
    void loadResourceShares();
  }, [open, target, loadResourceShares]);

  useEffect(() => {
    if (!open || activeTab !== "public-link" || loading || share) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy create when public tab is shown
    void ensurePublicLink();
  }, [open, activeTab, loading, share, ensurePublicLink]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setShare(null);
      setUserShares([]);
      setPageUrl("");
      setError("");
      setCopied(false);
      setActiveTab("public-link");
      setSettings(settingsFromShare(null));
      setInviteEmail("");
    }
    onOpenChange(next);
  }

  async function handleCopy() {
    if (!pageUrl) return;
    setError("");
    try {
      await copyTextToClipboard(pageUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  async function handleRevoke() {
    if (!share) return;
    setRevoking(true);
    setError("");
    try {
      await revokePublicShare(share.id);
      applyShareState(null);
      onShareChanged?.();
      onOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRevoking(false);
    }
  }

  // Human: Persist protection toggles on the active public share link.
  // Agent: PATCH /shares/:id; MAPS draft settings to API payload; REFRESHES share row.
  async function handleSaveSettings() {
    if (!share) {
      handleOpenChange(false);
      return;
    }

    if (settings.requirePassword && !share.requires_password && settings.password.trim().length < 4) {
      setError("Enter a password with at least 4 characters.");
      return;
    }

    if (settings.expirationEnabled && !settings.expiresAt) {
      setError("Choose an expiration date or disable link expiration.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const expiresAt = settings.expirationEnabled
        ? new Date(`${settings.expiresAt}T23:59:59.999Z`).toISOString()
        : null;

      const payload: {
        requires_password: boolean;
        password?: string | null;
        expires_at: string | null;
        block_download: boolean;
      } = {
        requires_password: settings.requirePassword,
        expires_at: expiresAt,
        block_download: settings.blockDownload,
      };

      if (settings.password.trim()) {
        payload.password = settings.password.trim();
      } else if (!settings.requirePassword) {
        payload.password = null;
      }

      const res = await updatePublicShare(share.id, payload);
      applyShareState(res.share);
      onShareChanged?.();
      handleOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleInviteUser() {
    if (!target) return;
    const email = inviteEmail.trim();
    if (!email) {
      setError("Enter an email address to invite.");
      return;
    }

    setInviting(true);
    setError("");
    try {
      const res = await inviteUserShare({
        resource_type: target.resource_type,
        resource_id: target.resource_id,
        email,
      });
      setUserShares((current) => [...current, res.user_share]);
      setInviteEmail("");
      onShareChanged?.();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeUser(userShareId: string) {
    setRevokingUserId(userShareId);
    setError("");
    try {
      await revokeUserShare(userShareId);
      setUserShares((current) => current.filter((row) => row.id !== userShareId));
      onShareChanged?.();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRevokingUserId(null);
    }
  }

  const resourceLabel = target?.resource_type === "folder" ? "folder" : "file";
  const dialogTitle = target?.resource_type === "folder" ? "Share folder" : "Share file";
  const linkBusy = loading || creatingLink;
  const linkDisplay = linkBusy ? "Generating link…" : pageUrl;
  const statusSubtitle =
    target?.resource_type === "folder"
      ? "Anyone on the internet with this link can browse this folder."
      : "Anyone on the internet with this link can view this file.";
  const expirationHint =
    settings.expirationEnabled && settings.expiresAt
      ? `Expires ${new Date(`${settings.expiresAt}T12:00:00`).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}`
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[#0A0A0A]/50 supports-backdrop-filter:backdrop-blur-[2px]"
        className={cn(
          "gap-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-0 shadow-[0_12px_24px_rgba(0,0,0,0.1)] ring-0 sm:max-w-[540px]",
        )}
      >
        <div className="flex max-h-[min(640px,calc(100vh-4rem))] flex-col gap-5 overflow-y-auto p-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-lg font-bold leading-tight text-[#1A1A1A]">
              {dialogTitle}
            </DialogTitle>
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#F7F8FA] text-[#666666] transition hover:bg-[#E5E7EB]/70 hover:text-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
              aria-label="Close share dialog"
              onClick={() => handleOpenChange(false)}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>

          {target ? (
            <p className="-mt-2 truncate text-sm font-medium text-[#666666]" title={target.name}>
              {target.name}
            </p>
          ) : null}

          <DialogDescription className="sr-only">
            Manage public links and user invitations for this {resourceLabel}.
          </DialogDescription>

          {error ? (
            <p
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <ShareDialogTabs activeTab={activeTab} onSelect={setActiveTab} />

          {activeTab === "invite" ? (
            <div className="flex flex-col gap-4">
              <p className="text-xs leading-relaxed text-[#888888]">
                Invite people who already have an account on this Ownly instance. Groups are not
                available yet.
              </p>

              <div className="flex min-w-0 items-stretch gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-2.5">
                  <Mail className="size-3.5 shrink-0 text-[#666666]" aria-hidden />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="name@company.com"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1A1A1A] outline-none placeholder:text-[#888888]"
                    disabled={inviting}
                  />
                </div>
                <button
                  type="button"
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-lg bg-[#2563EB] px-4 py-2.5 text-[13px] font-semibold text-white transition",
                    "hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                  disabled={inviting || !target}
                  onClick={() => void handleInviteUser()}
                >
                  {inviting ? <Loader2 className="size-3.5 animate-spin" /> : "Invite"}
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#888888]">
                  Invited users
                </p>
                {loading ? (
                  <p className="flex items-center gap-2 py-2 text-sm text-[#666666]">
                    <Loader2 className="size-4 animate-spin" />
                    Loading invitations…
                  </p>
                ) : userShares.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F7F8FA] px-3 py-4 text-center text-xs text-[#888888]">
                    No users invited yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {userShares.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-[#1A1A1A]">
                            {row.grantee_email}
                          </p>
                          <p className="text-[11px] text-[#888888]">
                            Invited {new Date(row.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-[12px] font-semibold text-[#666666] transition hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30 disabled:opacity-50"
                          disabled={revokingUserId === row.id}
                          onClick={() => void handleRevokeUser(row.id)}
                        >
                          {revokingUserId === row.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <UserMinus className="size-3.5" />
                          )}
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-4 py-4",
                  pageUrl || linkBusy
                    ? "border-[#BAE6FD] bg-[#E0F2FE]"
                    : "border-[#E5E7EB] bg-[#F7F8FA]",
                )}
              >
                <Globe
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    pageUrl || linkBusy ? "text-[#2563EB]" : "text-[#888888]",
                  )}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm font-semibold text-[#1A1A1A]">
                    {linkBusy
                      ? "Preparing public link…"
                      : pageUrl
                        ? "Public link sharing is active"
                        : "Public link unavailable"}
                  </p>
                  <p className="text-xs leading-relaxed text-[#666666]">
                    {linkBusy ? "Your shareable URL will appear in a moment." : statusSubtitle}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 items-stretch gap-2.5">
                <div
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-4 py-2.5"
                  title={pageUrl || undefined}
                >
                  <Link2 className="size-3.5 shrink-0 text-[#666666]" aria-hidden />
                  <p className="truncate font-mono text-[13px] text-[#1A1A1A]">{linkDisplay}</p>
                  {linkBusy ? (
                    <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-[#888888]" />
                  ) : null}
                </div>
                <button
                  type="button"
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#1A1A1A] transition",
                    "hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                  disabled={!pageUrl || linkBusy}
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <Check className="size-3.5 text-[#10B981]" aria-hidden />
                  ) : (
                    <Copy className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#888888]">
                  Link protection &amp; exporters
                </p>

                <ShareProtectionRow
                  icon={Lock}
                  title="Require password"
                  subtitle="Add a custom password requirement to unlock"
                  checked={settings.requirePassword}
                  disabled={linkBusy || !share}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({ ...current, requirePassword: checked }))
                  }
                >
                  {settings.requirePassword ? (
                    <div className="pl-7">
                      <input
                        type="password"
                        value={settings.password}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, password: event.target.value }))
                        }
                        placeholder={
                          share?.requires_password ? "Enter new password to change" : "Share password"
                        }
                        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] text-[#1A1A1A] outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
                        disabled={linkBusy || !share}
                      />
                    </div>
                  ) : null}
                </ShareProtectionRow>

                <ShareProtectionRow
                  icon={Calendar}
                  title="Set link expiration"
                  subtitle="Deactivate link automatically at a future date"
                  checked={settings.expirationEnabled}
                  disabled={linkBusy || !share}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({ ...current, expirationEnabled: checked }))
                  }
                >
                  {settings.expirationEnabled ? (
                    <div className="flex flex-col gap-1 pl-7">
                      <input
                        type="date"
                        value={settings.expiresAt}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, expiresAt: event.target.value }))
                        }
                        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] text-[#1A1A1A] outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
                        disabled={linkBusy || !share}
                      />
                      {expirationHint ? (
                        <p className="text-[11px] text-[#888888]">{expirationHint}</p>
                      ) : null}
                    </div>
                  ) : null}
                </ShareProtectionRow>

                <ShareProtectionRow
                  icon={ShieldAlert}
                  title="Block downloading &amp; printing"
                  subtitle="Restrict access to preview-only in the secure player"
                  checked={settings.blockDownload}
                  disabled={linkBusy || !share}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({ ...current, blockDownload: checked }))
                  }
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-[#E5E7EB] pt-4">
            {share ? (
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border border-[#FCA5A5] px-4 py-2.5 text-[13px] font-semibold text-[#EF4444] transition",
                  "hover:bg-[#FEF2F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EF4444]/30",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                disabled={revoking || linkBusy}
                onClick={() => void handleRevoke()}
              >
                {revoking ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden />
                )}
                Delete link
              </button>
            ) : (
              <span aria-hidden />
            )}
            <button
              type="button"
              className={cn(
                "ml-auto inline-flex items-center rounded-lg bg-[#2563EB] px-5 py-2.5 text-[13px] font-semibold text-white transition",
                "hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              disabled={saving || (activeTab === "public-link" && linkBusy)}
              onClick={() => void handleSaveSettings()}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save settings
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
