// Human: Desktop page chrome — where-you-are on the left, account menu on the right.
// Agent: RENDERS DriveProfileTrigger + DriveProfileMenu; CALLS onSignOut/onAdminConsole; Tailwind tokens only.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DriveProfileMenu } from "@/components/drive/DriveProfileMenu";
import { DriveProfileTrigger } from "@/components/drive/DriveProfileTrigger";
import { cn } from "@/lib/utils";

export type DriveDesktopTopbarProps = {
  displayName: string;
  roleLabel: string;
  initials: string;
  email?: string | null;
  isAdmin?: boolean;
  /**
   * Human: Where the user is — section or page name, shown at the left of the bar.
   * Agent: Routes that show a breadcrumb pass `leadingSlotRef` instead; this is the fallback.
   */
  title?: string;
  /**
   * Human: When set, the left region becomes an empty slot the drive fills with its breadcrumb
   * trail instead of showing the title.
   * Agent: CALLBACK REF handed to DrivePage, which passes the resulting node to DriveCloudExplorer
   *        as a portal target. The breadcrumb keeps its drag-drop state inside the explorer.
   */
  leadingSlotRef?: (node: HTMLDivElement | null) => void;
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
  title,
  leadingSlotRef,
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

  // Human: Open the signed-in user's profile page from the account dropdown.
  // Agent: NAVIGATE /profile; WRITES profileOpen false before routing.
  const handleProfile = useCallback(() => {
    setProfileOpen(false);
    navigate("/profile");
  }, [navigate]);

  // Human: Open account settings from the profile dropdown Settings row.
  // Agent: NAVIGATE /settings; WRITES profileOpen false before routing.
  const handleSettings = useCallback(() => {
    setProfileOpen(false);
    navigate("/settings");
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
        // Human: Full-bleed bar with a single hairline floor — it spans sidebar-to-edge rather
        // than floating as a card, so it reads as page chrome instead of another content panel.
        // Agent: Gutters live INSIDE as padding so the bar's contents line up with the page
        //        column below it; `sticky` only bites on the routes that nest it in a scroll pane.
        //        Width stays `auto` — the flex parent stretches it, so callers that sit inside a
        //        padded pane can widen it with negative margins (`w-full` would cap it instead).
        "sticky top-0 z-30 hidden h-14 shrink-0 items-center justify-between gap-4",
        "border-b border-edge bg-panel px-4 lg:flex lg:px-12",
        className,
      )}
    >
      {/* Human: Left — folder trail on the explorer, section title everywhere else. */}
      {leadingSlotRef ? (
        <div ref={leadingSlotRef} className="flex min-w-0 flex-1 items-center" />
      ) : (
        <h1 className="min-w-0 truncate text-[15px] font-semibold text-ink">{title}</h1>
      )}

      {/* Human: Right — hairline separates page state from account controls. */}
      {/* Agent: RENDERS DriveProfileTrigger + DriveProfileMenu; no inline sign-out per wireframe. */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="h-6 w-px bg-edge" aria-hidden />
        <div ref={profileAnchorRef} className="relative">
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
            onProfile={handleProfile}
            onSettings={handleSettings}
          />
        </div>
      </div>
    </header>
  );
}
