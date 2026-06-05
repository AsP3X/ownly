// Human: Section navigation card — Pencil Section Navigation with active blue row.
// Agent: READS activeSection; EMITS onSelect; SCROLLS matching right-column cards.

import { Bell, Lock, Monitor, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ProfileCard } from "@/components/profile/profile-ui";
import { cn } from "@/lib/utils";

export type ProfileSectionId = "details" | "security" | "sessions" | "preferences";

type NavItem = {
  id: ProfileSectionId;
  label: string;
  icon: LucideIcon;
  targetId: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "details", label: "Profile Details", icon: User, targetId: "profile-details" },
  { id: "security", label: "Security & Password", icon: Lock, targetId: "profile-security" },
  { id: "sessions", label: "Authorized Sessions", icon: Monitor, targetId: "profile-sessions" },
  { id: "preferences", label: "Preferences", icon: Bell, targetId: "profile-preferences" },
];

export type ProfileSectionNavProps = {
  activeSection: ProfileSectionId;
  onSelect: (section: ProfileSectionId) => void;
};

/** Human: Left-column section picker — active row uses #EFF6FF + accent per Pencil. */
export function ProfileSectionNav({ activeSection, onSelect }: ProfileSectionNavProps) {
  return (
    <ProfileCard className="p-4">
      <nav className="flex flex-col gap-1" aria-label="Profile sections">
        {NAV_ITEMS.map((item) => {
          const active = item.id === activeSection;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                document.getElementById(item.targetId)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left text-[13px] transition-colors",
                active
                  ? "bg-[#EFF6FF] font-semibold text-[#2563EB]"
                  : "font-medium text-[#666666] hover:bg-[#F7F8FA]",
              )}
            >
              <Icon
                className={cn("size-4 shrink-0", active ? "text-[#2563EB]" : "text-[#666666]")}
                aria-hidden
              />
              {item.label}
            </button>
          );
        })}
      </nav>
    </ProfileCard>
  );
}
