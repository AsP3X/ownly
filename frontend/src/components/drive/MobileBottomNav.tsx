// Human: iOS-style bottom tab bar for mobile drive navigation.
// Agent: RENDERS below lg only; CALLS onNavChange + onUpload + onMenuOpen.

import { FolderOpen, Home, Menu, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItemId = "home" | "my-files" | "recycle-bin";

type MobileBottomNavProps = {
  activeNav: NavItemId;
  onNavChange: (nav: NavItemId) => void;
  onUpload: () => void;
  onMenuOpen: () => void;
};

type TabProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
};

// Human: Single tab button with pill highlight when active.
// Agent: RENDERS icon + label stack; USED by MobileBottomNav grid.
function TabButton({ label, active, onClick, icon }: TabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 transition-colors",
        active ? "text-blue-700" : "text-neutral-500 active:text-neutral-700",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full transition-colors",
          active ? "bg-blue-100 text-blue-700" : "bg-transparent",
        )}
      >
        {icon}
      </span>
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </button>
  );
}

// Human: Four-tab mobile chrome — Home, Files, Upload, More — with glass background.
// Agent: fixed bottom-0 z-40; hidden on lg+ so desktop layout stays unchanged.
export function MobileBottomNav({
  activeNav,
  onNavChange,
  onUpload,
  onMenuOpen,
}: MobileBottomNavProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      aria-label="Mobile navigation"
    >
      <div className="mx-auto grid h-[4.25rem] max-w-lg grid-cols-4 items-center px-2">
        <TabButton
          label="Home"
          active={activeNav === "home"}
          onClick={() => onNavChange("home")}
          icon={<Home className="size-[18px]" />}
        />
        <TabButton
          label="Files"
          active={activeNav === "my-files"}
          onClick={() => onNavChange("my-files")}
          icon={<FolderOpen className="size-[18px]" />}
        />
        <TabButton
          label="Upload"
          active={false}
          onClick={onUpload}
          icon={<Upload className="size-[18px]" />}
        />
        <TabButton
          label="More"
          active={false}
          onClick={onMenuOpen}
          icon={<Menu className="size-[18px]" />}
        />
      </div>
    </nav>
  );
}
