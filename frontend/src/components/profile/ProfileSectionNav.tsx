// Human: Section navigation card — Pencil Section Navigation with active blue row.
// Agent: READS variant + activeSection; EMITS onSelect; SCROLLS matching right-column cards.

import { Bell, Lock, Monitor, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ProfileCard } from "@/components/profile/profile-ui";
import { cn } from "@/lib/utils";

export type ProfileOnlySectionId = "details" | "preferences";

export type SettingsSectionId = "details" | "security" | "sessions" | "preferences";

type NavItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
  targetId: string;
};

const PROFILE_NAV_ITEMS: NavItem<ProfileOnlySectionId>[] = [
  { id: "details", label: "Profile Details", icon: User, targetId: "profile-details" },
  { id: "preferences", label: "Preferences", icon: Bell, targetId: "profile-preferences" },
];

const SETTINGS_NAV_ITEMS: NavItem<SettingsSectionId>[] = [
  { id: "details", label: "Profile Details", icon: User, targetId: "settings-profile-details" },
  { id: "security", label: "Security & Password", icon: Lock, targetId: "settings-security" },
  { id: "sessions", label: "Authorized Sessions", icon: Monitor, targetId: "settings-sessions" },
  { id: "preferences", label: "Preferences", icon: Bell, targetId: "settings-preferences" },
];

type ProfileSectionNavProps =
  | {
      variant: "profile";
      activeSection: ProfileOnlySectionId;
      onSelect: (section: ProfileOnlySectionId) => void;
    }
  | {
      variant: "settings";
      activeSection: SettingsSectionId;
      onSelect: (section: SettingsSectionId) => void;
    };

/** Human: Left-column section picker — active row uses #EFF6FF + accent per Pencil. */
export function ProfileSectionNav(props: ProfileSectionNavProps) {
  const items =
    props.variant === "profile"
      ? PROFILE_NAV_ITEMS
      : SETTINGS_NAV_ITEMS;

  return (
    <ProfileCard className="p-4">
      <nav
        className="flex flex-col gap-1"
        aria-label={props.variant === "profile" ? "Profile sections" : "Settings sections"}
      >
        {items.map((item) => {
          const active = item.id === props.activeSection;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                props.onSelect(item.id as never);
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
