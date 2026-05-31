// Human: Desktop session chrome from login-signup.pencil component/Topbar — status + profile dropdown.
// Agent: RENDERS DriveProfileTrigger + DriveProfileMenu; CALLS onSignOut/onAdminConsole; Tailwind tokens only.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { DriveProfileMenu } from "@/components/drive/DriveProfileMenu";
import { DriveProfileTrigger } from "@/components/drive/DriveProfileTrigger";
import { cn } from "@/lib/utils";

export type DriveDesktopTopbarProps = {
  displayName: string;
  roleLabel: string;
  initials: string;
  email?: string | null;
  isAdmin?: boolean;
  /** Human: Left status line — drive default vs admin console override from Pencil topbar. */
  statusText?: string;
  onSignOut: () => void;
  className?: string;
};

// Human: Full-width bar above drive main content on lg+ — mobile uses MobileDriveHeader instead.
// Agent: READS display props; WRITES profileOpen; HTTP sign-out via parent onSignOut; admin → /admin.
export function DriveDesktopTopbar({
  displayName,
  roleLabel,
  initials,
  email,
  isAdmin = false,
  statusText = "Secure Encrypted Session Active",
  onSignOut,
  className,
}: DriveDesktopTopbarProps) {
  const navigate = useNavigate();
  const profileAnchorRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const handleSignOut = useCallback(() => {
    setProfileOpen(false);
    onSignOut();
  }, [onSignOut]);

  const handleAdminConsole = useCallback(() => {
    setProfileOpen(false);
    navigate("/admin");
  }, [navigate]);

  // Human: Dismiss profile popover when pointer down occurs outside the anchor cluster.
  // Agent: LISTENS document mousedown; READS profileAnchorRef; WRITES profileOpen false.
  useEffect(() => {
    if (!profileOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!profileAnchorRef.current?.contains(target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [profileOpen]);

  return (
    <header
      className={cn(
        "hidden h-16 shrink-0 items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-6 lg:flex",
        className,
      )}
    >
      {/* Human: Left cluster — shield + encrypted session copy per Pencil Left Group */}
      <div className="flex min-w-0 items-center gap-3">
        <ShieldCheck className="size-4 shrink-0 text-[#10B981]" aria-hidden />
        <p className="truncate text-[13px] font-medium text-[#666666]">{statusText}</p>
      </div>

      {/* Human: Right cluster — profile trigger + dropdown (no inline sign-out per Profile Menu wireframe) */}
      <div ref={profileAnchorRef} className="relative shrink-0">
        <DriveProfileTrigger
          displayName={displayName}
          roleLabel={roleLabel}
          initials={initials}
          open={profileOpen}
          onClick={() => setProfileOpen((open) => !open)}
        />
        <DriveProfileMenu
          open={profileOpen}
          displayName={displayName}
          email={email}
          initials={initials}
          roleLabel={roleLabel}
          isAdmin={isAdmin}
          onLogout={handleSignOut}
          onAdminConsole={isAdmin ? handleAdminConsole : undefined}
        />
      </div>
    </header>
  );
}
