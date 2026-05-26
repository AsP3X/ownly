// Human: Left drawer with drive navigation, shortcuts, and storage — replaces the stacked sidebar on mobile.
// Agent: Sheet side=left; CALLS parent nav/upload/create-folder handlers; READS usage stats for quota bar.

import { type ReactNode } from "react";
import {
  FolderOpen,
  FolderPlus,
  Home,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type NavItemId = "home" | "my-files" | "recycle-bin";

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

// Human: Drawer nav row with icon pill and active highlight.
// Agent: RENDERS button; HIGHLIGHTS when id matches activeNav.
function DrawerNavItem({
  label,
  icon,
  active,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
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
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
        active && "bg-blue-50 font-semibold text-blue-800",
        !active && !disabled && "text-neutral-700 active:bg-neutral-100",
        disabled && "cursor-not-allowed text-neutral-400",
      )}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-xl",
          active ? "bg-blue-100 text-blue-700" : "bg-neutral-100 text-neutral-600",
          disabled && "bg-neutral-50 text-neutral-300",
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// Human: Slide-in menu opened from the header or bottom More tab on viewports below lg.
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
      <SheetContent side="left" className="w-[min(100vw-1rem,22rem)] gap-0 p-0">
        <SheetHeader className="border-b border-neutral-100 bg-white px-5 py-5 text-left">
          <SheetTitle className="text-xl font-semibold tracking-tight">MediaVault</SheetTitle>
          <SheetDescription>Your personal file library</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-[#f3f2f1] px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="h-auto flex-col gap-2 rounded-2xl bg-blue-600 py-4 text-white hover:bg-blue-700"
              onClick={handleUpload}
            >
              <Upload className="size-5" />
              Upload
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 rounded-2xl border-neutral-200 bg-white py-4 text-neutral-800 hover:bg-neutral-50"
              onClick={handleCreateFolder}
            >
              <FolderPlus className="size-5" />
              New folder
            </Button>
          </div>

          <nav className="flex flex-col gap-1 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-neutral-200/70" aria-label="Drive navigation">
            <DrawerNavItem
              label="Home"
              icon={<Home className="size-4" />}
              active={activeNav === "home"}
              onClick={() => handleNav("home")}
            />
            <DrawerNavItem
              label="My files"
              icon={<FolderOpen className="size-4" />}
              active={activeNav === "my-files"}
              onClick={() => handleNav("my-files")}
            />
            <DrawerNavItem label="Shared" icon={<Users className="size-4" />} active={false} disabled />
            <DrawerNavItem
              label="Recycle bin"
              icon={<Trash2 className="size-4" />}
              active={activeNav === "recycle-bin"}
              onClick={() => handleNav("recycle-bin")}
            />
          </nav>

          <div className="mt-auto flex flex-col gap-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
              <div className="mb-3 flex items-center justify-between text-sm font-medium text-neutral-800">
                <span>Storage</span>
                <span className="tabular-nums text-blue-700">{usagePercent}%</span>
              </div>
              {storageBar}
              <p className="mt-2 text-xs text-neutral-500">
                {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
              </p>
              <Button variant="ghost" size="sm" className="mt-3 w-full text-blue-700">
                Get more storage
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
