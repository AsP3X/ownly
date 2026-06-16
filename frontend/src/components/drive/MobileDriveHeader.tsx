// Human: Compact sticky header for mobile drive — title, search, profile menu (login-signup.pencil).
// Agent: lg:hidden only; CALLS DriveProfileMenu; REPLACES cramped desktop header grid below lg breakpoint.

import { type RefObject, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  FolderPlus,
  Menu,
  Search,
  Upload,
} from "lucide-react";
import { useInstanceName } from "@/hooks/useInstanceName";
import { DriveProfileMenu } from "@/components/drive/DriveProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { DriveNavId } from "@/components/drive/DriveSidebar";

type NavItemId = DriveNavId;
type FolderCrumb = { id: string; name: string };

type MobileDriveHeaderProps = {
  activeNav: NavItemId;
  folderStack: FolderCrumb[];
  query: string;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  displayName: string;
  roleLabel: string;
  initials: string;
  email?: string | null;
  isAdmin?: boolean;
  profileOpen: boolean;
  profileRef: RefObject<HTMLDivElement | null>;
  onProfileToggle: () => void;
  onLogout: () => void;
  onMenuOpen: () => void;
  onUpload: () => void;
  onCreateFolder: () => void;
  onBack: () => void;
};

// Human: Sticky mobile chrome with large title, integrated search, and folder back navigation.
// Agent: CALLS parent handlers only; hidden on lg+ so desktop DriveDesktopTopbar is unchanged.
export function MobileDriveHeader({
  activeNav,
  folderStack,
  query,
  onQueryChange,
  onQuerySubmit,
  displayName,
  roleLabel,
  initials,
  email,
  isAdmin = false,
  profileOpen,
  profileRef,
  onProfileToggle,
  onLogout,
  onMenuOpen,
  onUpload,
  onCreateFolder,
  onBack,
}: MobileDriveHeaderProps) {
  const navigate = useNavigate();
  const { instanceName } = useInstanceName();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Human: Mobile search submits on Enter and keeps the field focused for quick edits.
  // Agent: READS keydown on search input; CALLS onQuerySubmit; REFOCUSES + RESTORES cursor at end.
  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onQuerySubmit();
    const input = searchInputRef.current;
    if (!input) return;
    window.setTimeout(() => {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 0);
  }

  // Human: Close the popover before routing — toggle only when open avoids opening it accidentally.
  // Agent: WRITES profileOpen via onProfileToggle; NAVIGATE /admin for administrators.
  function handleAdminConsole() {
    if (profileOpen) onProfileToggle();
    navigate("/admin");
  }

  // Human: Route to the profile page from the mobile account menu.
  // Agent: NAVIGATE /profile; CLOSES popover via onProfileToggle when open.
  function handleProfile() {
    if (profileOpen) onProfileToggle();
    navigate("/profile");
  }

  // Human: Route to account settings from the mobile account menu.
  // Agent: NAVIGATE /settings; CLOSES popover via onProfileToggle when open.
  function handleSettings() {
    if (profileOpen) onProfileToggle();
    navigate("/settings");
  }

  const inFolder = activeNav === "my-files" && folderStack.length > 0;
  const pageTitle = inFolder
    ? (folderStack.at(-1)?.name ?? "My files")
    : activeNav === "home"
      ? "My Cloud"
      : activeNav === "shared-files"
        ? "Shared Files"
      : activeNav === "recycle-bin"
        ? "Recycle bin"
        : "My Cloud";

  return (
    <header
      className={cn(
        "sticky top-0 z-30 shrink-0 border-b border-[#E5E7EB] backdrop-blur-xl lg:hidden",
        activeNav === "home" || activeNav === "my-files"
          ? "bg-[#F7F8FA]/95"
          : activeNav === "shared-files"
            ? "bg-[#F7F8FA]/95"
          : "bg-[#f3f2f1]/95",
      )}
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {inFolder ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-[#666666]"
            aria-label="Go back"
            onClick={onBack}
          >
            <ArrowLeft className="size-5" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-[#666666]"
            aria-label="Open menu"
            onClick={onMenuOpen}
          >
            <Menu className="size-5" />
          </Button>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-[#888888]">
            {inFolder ? "Folder" : activeNav === "home" ? instanceName : "Library"}
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight text-[#1A1A1A]">
            {pageTitle}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {activeNav === "my-files" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-[#666666]"
              aria-label="New folder"
              onClick={onCreateFolder}
            >
              <FolderPlus className="size-5" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-[#2563EB]"
            aria-label="Upload files"
            onClick={onUpload}
          >
            <Upload className="size-5" />
          </Button>
          <div ref={profileRef} className="relative">
            <button
              type="button"
              aria-label="Open account menu"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              onClick={onProfileToggle}
              className={cn(
                "flex size-9 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white shadow-sm outline-none",
                profileOpen && "ring-2 ring-[#2563EB]/30 ring-offset-2 ring-offset-[#F7F8FA]",
              )}
            >
              {initials}
            </button>
            <DriveProfileMenu
              open={profileOpen}
              displayName={displayName}
              email={email}
              initials={initials}
              roleLabel={roleLabel}
              isAdmin={isAdmin}
              onLogout={onLogout}
              onAdminConsole={isAdmin ? handleAdminConsole : undefined}
              onProfile={handleProfile}
              onSettings={handleSettings}
            />
          </div>
        </div>
      </div>

      {activeNav !== "home" && activeNav !== "my-files" ? (
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#888888]" />
            <Input
              ref={searchInputRef}
              className={cn(
                "h-10 rounded-lg border border-[#E5E7EB] bg-white pl-10 shadow-none",
                "placeholder:text-[#888888] focus-visible:border-[#2563EB] focus-visible:ring-[#2563EB]/25",
              )}
              placeholder="Search files"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label="Search files. Press Enter to search."
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}
