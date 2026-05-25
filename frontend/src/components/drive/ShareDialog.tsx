// Human: Modal to create, copy, or revoke a public link for one file or folder.
// Agent: CALLS createPublicShare/lookupPublicShare/revokePublicShare; WRITES clipboard via publicSharePageUrl.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, ShieldOff } from "lucide-react";
import {
  createPublicShare,
  getErrorMessage,
  lookupPublicShare,
  publicSharePageUrl,
  revokePublicShare,
  type ShareLink,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type ShareTarget =
  | { resource_type: "file"; resource_id: string; name: string }
  | { resource_type: "folder"; resource_id: string; name: string };

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget | null;
  onShareChanged?: () => void;
};

export function ShareDialog({ open, onOpenChange, target, onShareChanged }: ShareDialogProps) {
  const [share, setShare] = useState<ShareLink | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Human: Load or create the share row whenever the dialog opens for a new target.
  // Agent: CALLS lookup then create; SETS pageUrl from token.
  const loadShare = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const lookup =
        target.resource_type === "file"
          ? await lookupPublicShare({ file_id: target.resource_id })
          : await lookupPublicShare({ folder_id: target.resource_id });

      let active = lookup.share;
      if (!active) {
        const created = await createPublicShare({
          resource_type: target.resource_type,
          resource_id: target.resource_id,
        });
        active = created.share;
        onShareChanged?.();
      }

      setShare(active);
      setPageUrl(publicSharePageUrl(active.token));
    } catch (e) {
      setShare(null);
      setPageUrl("");
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [target, onShareChanged]);

  // Human: Parent sets open=true directly (controlled mode) — onOpenChange does not fire on mount.
  // Agent: WATCH open+target; CALLS loadShare when dialog becomes visible.
  useEffect(() => {
    if (!open || !target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async share fetch when controlled open flips true
    void loadShare();
  }, [open, target, loadShare]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setShare(null);
      setPageUrl("");
      setError("");
      setCopied(false);
    }
    onOpenChange(next);
  }

  async function handleCopy() {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
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
      setShare(null);
      setPageUrl("");
      onShareChanged?.();
      onOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRevoking(false);
    }
  }

  const resourceLabel = target?.resource_type === "folder" ? "folder" : "file";
  const linkLabel = loading ? "Generating link…" : pageUrl;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Agent: overflow-hidden + p-0 keeps long filenames/URLs inside the modal shell. */}
      <DialogContent className="gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-md">
        <DialogHeader className="min-w-0 border-b border-neutral-100 px-6 py-5 pr-12">
          <DialogTitle className="text-lg text-neutral-900">Share link</DialogTitle>
          {target ? (
            <p className="truncate text-sm font-medium text-neutral-800" title={target.name}>
              {target.name}
            </p>
          ) : null}
          <DialogDescription className="text-neutral-500">
            Anyone with this link can view and download{" "}
            {target?.resource_type === "folder"
              ? "files inside this folder"
              : "this file"}{" "}
            — no account required. Other files in your drive stay private.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4 px-6 py-5">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {/* Agent: READ-ONLY truncated block — inputs resist shrinking with long URLs in flex rows. */}
          <div className="flex min-w-0 items-stretch gap-2">
            <div
              className="min-w-0 flex-1 overflow-hidden rounded-lg border border-input bg-muted/30 px-3 py-2"
              title={pageUrl || undefined}
            >
              <p className="truncate font-mono text-xs text-foreground">{linkLabel}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={!pageUrl || loading}
              onClick={() => void handleCopy()}
              aria-label="Copy link"
            >
              {copied ? <Check className="text-emerald-600" /> : <Copy />}
            </Button>
          </div>

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Preparing link…
            </p>
          ) : pageUrl ? (
            <p className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Recipients only see this {resourceLabel}. Revoke the link anytime to cut access.
              </span>
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 border-neutral-100 bg-neutral-50/80">
          {share ? (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={revoking || loading}
              onClick={() => void handleRevoke()}
            >
              {revoking ? <Loader2 className="animate-spin" /> : <ShieldOff />}
              Revoke link
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
