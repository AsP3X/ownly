// Human: Fixed bottom tab bar for mobile drive navigation — Home, My files, and upload shortcut.
// Agent: RENDERS below lg only; CALLS onNavChange + onUpload; HIGHLIGHTS activeNav tab.

import { FolderOpen, Home, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type NavItemId = "home" | "my-files";

type MobileBottomNavProps = {
  activeNav: NavItemId;
  onNavChange: (nav: NavItemId) => void;
  onUpload: () => void;
};

// Human: Three-tab mobile chrome with a raised upload action in the center.
// Agent: fixed bottom-0 z-40; hidden on lg+ so desktop sidebar layout is unchanged.
export function MobileBottomNav({ activeNav, onNavChange, onUpload }: MobileBottomNavProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Mobile navigation"
    >
      <div className="mx-auto grid h-16 max-w-lg grid-cols-3 items-end px-2">
        <button
          type="button"
          onClick={() => onNavChange("home")}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
            activeNav === "home" ? "text-blue-700" : "text-neutral-600",
          )}
          aria-current={activeNav === "home" ? "page" : undefined}
        >
          <Home className={cn("size-5", activeNav === "home" && "fill-blue-100")} />
          Home
        </button>

        <div className="flex justify-center pb-2">
          <Button
            type="button"
            size="icon-lg"
            className="size-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700"
            onClick={onUpload}
            aria-label="Upload files"
          >
            <Upload className="size-6" />
          </Button>
        </div>

        <button
          type="button"
          onClick={() => onNavChange("my-files")}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
            activeNav === "my-files" ? "text-blue-700" : "text-neutral-600",
          )}
          aria-current={activeNav === "my-files" ? "page" : undefined}
        >
          <FolderOpen className={cn("size-5", activeNav === "my-files" && "fill-blue-100")} />
          My files
        </button>
      </div>
    </nav>
  );
}
