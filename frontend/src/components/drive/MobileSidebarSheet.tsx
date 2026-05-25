// Human: Left drawer with drive navigation, shortcuts, and storage — replaces the stacked sidebar on mobile.
// Agent: Sheet side=left; CALLS parent nav/upload/create-folder handlers; READS usage stats for quota bar.

import { type ReactNode } from "react";
import { FolderPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type NavItemId = "home" | "my-files";

type MobileSidebarSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeNav: NavItemId;
  usedBytes: number;
  quotaBytes: number;
  usagePercent: number;
  onNavChange: (nav: NavItemId) => void;
  onUpload: () => void;
  onCreateFolder: () => void;
  storageBar: ReactNode;
};

// Human: OneDrive-style nav row reused inside the mobile drawer.
// Agent: RENDERS button; HIGHLIGHTS when id matches activeNav.
function DrawerNavItem({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md py-2.5 pl-1 pr-2 text-left text-sm transition-colors",
        active && "font-semibold text-blue-700",
        !active && !disabled && "text-neutral-700 hover:bg-neutral-100",
        disabled && "cursor-not-allowed text-neutral-400",
      )}
    >
      <span
        className={cn(
          "h-[18px] w-[3px] shrink-0 rounded-full",
          active ? "bg-blue-600" : "bg-transparent",
        )}
        aria-hidden
      />
      <span>{label}</span>
    </button>
  );
}

// Human: Slide-in menu opened from the header hamburger on viewports below lg.
// Agent: WRITES onOpenChange(false) after nav/upload actions so the drawer closes on selection.
export function MobileSidebarSheet({
  open,
  onOpenChange,
  activeNav,
  usedBytes,
  quotaBytes,
  usagePercent,
  onNavChange,
  onUpload,
  onCreateFolder,
  storageBar,
}: MobileSidebarSheetProps) {
  function handleNav(nav: NavItemId) {
    onNavChange(nav);
    onOpenChange(false);
  }

  function handleUpload() {
    onUpload();
    onOpenChange(false);
  }

  function handleCreateFolder() {
    onCreateFolder();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[min(100vw-2rem,20rem)] gap-0 p-0">
        <SheetHeader className="border-b border-neutral-200 px-4 py-4 text-left">
          <SheetTitle className="text-lg">MediaVault</SheetTitle>
          <SheetDescription>Browse and manage your files</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <Button
            className="w-full justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
            onClick={handleUpload}
          >
            <Upload data-icon="inline-start" />
            Create or upload
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center rounded-md border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50"
            onClick={handleCreateFolder}
          >
            <FolderPlus data-icon="inline-start" />
            New folder
          </Button>

          <nav className="flex flex-col gap-0.5" aria-label="Drive navigation">
            <DrawerNavItem
              label="Home"
              active={activeNav === "home"}
              onClick={() => handleNav("home")}
            />
            <DrawerNavItem
              label="My files"
              active={activeNav === "my-files"}
              onClick={() => handleNav("my-files")}
            />
            <DrawerNavItem label="Shared" active={false} disabled />
            <DrawerNavItem label="Recycle bin" active={false} disabled />
          </nav>

          <Separator className="bg-neutral-200" />

          <div className="mt-auto flex flex-col gap-3 pt-2">
            <Button variant="ghost" size="sm" className="justify-start px-0 text-blue-700">
              Get more storage
            </Button>
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between text-xs font-medium text-neutral-700">
                <span>Storage</span>
                <span className="tabular-nums">{usagePercent}%</span>
              </div>
              {storageBar}
              <p className="text-xs text-neutral-600">
                {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
