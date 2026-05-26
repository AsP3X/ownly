// Human: Manage the public share link for one file or folder inside the details dialog.
// Agent: CALLS fetchResourceShares/createPublicShare/revokePublicShare; EMITS onChanged after mutations.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Globe, Link2, Loader2, ShieldOff, Users } from "lucide-react";
import {
  createPublicShare,
  fetchResourceShares,
  getErrorMessage,
  publicSharePageUrl,
  revokePublicShare,
  type ShareLink,
} from "@/api/client";
import { copyTextToClipboard } from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ShareTarget } from "@/components/drive/ShareDialog";

type ShareLinksPanelProps = {
  target: ShareTarget;
  onChanged?: () => void;
};

export function ShareLinksPanel({ target, onChanged }: ShareLinksPanelProps) {
  const [publicShare, setPublicShare] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const pageUrl = publicShare ? publicSharePageUrl(publicShare.token) : "";

  // Human: Load current public link state for this resource.
  // Agent: GET /shares/resource; SETS publicShare from response.
  const loadShares = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res =
        target.resource_type === "file"
          ? await fetchResourceShares({ file_id: target.resource_id })
          : await fetchResourceShares({ folder_id: target.resource_id });
      setPublicShare(res.public_share);
    } catch (e) {
      setPublicShare(null);
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [target.resource_id, target.resource_type]);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  async function handleCreateLink() {
    setCreating(true);
    setError("");
    try {
      const res = await createPublicShare({
        resource_type: target.resource_type,
        resource_id: target.resource_id,
      });
      setPublicShare(res.share);
      onChanged?.();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!publicShare) return;
    setRevoking(true);
    setError("");
    try {
      await revokePublicShare(publicShare.id);
      setPublicShare(null);
      onChanged?.();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRevoking(false);
    }
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

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading share links…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-sky-600" />
          <h3 className="text-sm font-semibold text-neutral-900">Public link</h3>
        </div>
        <p className="text-sm text-neutral-600">
          Anyone with the link can view and download this{" "}
          {target.resource_type === "folder" ? "folder" : "file"} without signing in.
        </p>

        {publicShare ? (
          <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50/80 p-4">
            <div className="flex min-w-0 items-stretch gap-2">
              <div
                className="min-w-0 flex-1 overflow-hidden rounded-lg border border-input bg-white px-3 py-2"
                title={pageUrl}
              >
                <p className="truncate font-mono text-xs text-foreground">{pageUrl}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => void handleCopy()}
                aria-label="Copy public link"
              >
                {copied ? <Check className="text-emerald-600" /> : <Copy />}
              </Button>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              Created {new Date(publicShare.created_at).toLocaleString()}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-fit text-destructive hover:text-destructive"
              disabled={revoking}
              onClick={() => void handleRevoke()}
            >
              {revoking ? <Loader2 className="animate-spin" /> : <ShieldOff />}
              Revoke public link
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={creating}
            onClick={() => void handleCreateLink()}
          >
            {creating ? <Loader2 className="animate-spin" /> : <Link2 />}
            Create public link
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-100 pt-6">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-neutral-500" />
          <h3 className="text-sm font-semibold text-neutral-900">Shared with users</h3>
        </div>
        <p className="text-sm text-neutral-500">
          Inviting specific people to this {target.resource_type} is not available yet.
        </p>
      </section>
    </div>
  );
}
