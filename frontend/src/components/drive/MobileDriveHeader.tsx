// Human: Compact sticky header for mobile drive — title, search, profile, and contextual actions.
// Agent: lg:hidden only; REPLACES cramped desktop header grid below lg breakpoint.

import { type RefObject } from "react";
import {
  ArrowLeft,
  FolderPlus,
  LogOut,
  Menu,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type NavItemId = "home" | "my-files" | "recycle-bin";
type FolderCrumb = { id: string; name: string };

type MobileDriveHeaderProps = {
  activeNav: NavItemId;
  folderStack: FolderCrumb[];
  query: string;
  onQueryChange: (value: string) => void;
  initials: string;
  email?: string | null;
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
// Agent: CALLS parent handlers only; hidden on lg+ so desktop header is unchanged.
export function MobileDriveHeader({
  activeNav,
  folderStack,
  query,
  onQueryChange,
  initials,
  email,
  profileOpen,
  profileRef,
  onProfileToggle,
  onLogout,
  onMenuOpen,
  onUpload,
  onCreateFolder,
  onBack,
}: MobileDriveHeaderProps) {
  const inFolder = activeNav === "my-files" && folderStack.length > 0;
  const pageTitle = inFolder
    ? (folderStack.at(-1)?.name ?? "My files")
    : activeNav === "home"
      ? "My Cloud"
      : activeNav === "recycle-bin"
        ? "Recycle bin"
        : "My Cloud";

  return (
    <header
      className={cn(
        "sticky top-0 z-30 shrink-0 border-b border-neutral-200/80 backdrop-blur-xl lg:hidden",
        activeNav === "home" || activeNav === "my-files"
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
            className="shrink-0 text-neutral-700"
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
            className="shrink-0 text-neutral-700"
            aria-label="Open menu"
            onClick={onMenuOpen}
          >
            <Menu className="size-5" />
          </Button>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-neutral-500">
            {inFolder ? "Folder" : activeNav === "home" ? "Ownly" : "Library"}
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight text-neutral-900">
            {pageTitle}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {activeNav === "my-files" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-neutral-700"
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
            className="text-blue-700"
            aria-label="Upload files"
            onClick={onUpload}
          >
            <Upload className="size-5" />
          </Button>
          <div ref={profileRef} className="relative">
            <button
              type="button"
              aria-label="Open profile menu"
              aria-expanded={profileOpen}
              onClick={onProfileToggle}
              className="flex size-9 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white shadow-sm"
            >
              {initials}
            </button>
            {profileOpen ? (
              <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-neutral-200 bg-white py-1 shadow-xl">
                <p className="truncate px-4 py-3 text-sm text-neutral-500">{email}</p>
                <Separator />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-neutral-800 active:bg-neutral-50"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onLogout();
                  }}
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {activeNav !== "home" && activeNav !== "my-files" ? (
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              className={cn(
                "h-10 rounded-xl border-0 bg-white pl-10 shadow-sm ring-1 ring-neutral-200/80",
                "placeholder:text-neutral-400 focus-visible:ring-blue-500/40",
              )}
              placeholder="Search files"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              aria-label="Search files"
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}
