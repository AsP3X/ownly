// Human: Profile dropdown from login-signup.pencil — Standard (244px) and Admin (280px) explorer menus.
// Agent: RENDERS header + rows; CALLS onLogout/onAdminConsole; Tailwind-only; parent owns open state and anchor ref.

import type { ComponentType } from "react";
import { LogOut, Settings, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type DriveProfileMenuProps = {
  open: boolean;
  displayName: string;
  email?: string | null;
  initials: string;
  roleLabel: string;
  isAdmin?: boolean;
  onLogout: () => void;
  onAdminConsole?: () => void;
  onProfile?: () => void;
  className?: string;
};

// Human: Uppercase badge copy for the standard profile header — maps API role to Pencil “PRO MEMBER” chip.
// Agent: READS roleLabel; RETURNS badge string for non-admin dropdown header.
function profileBadgeLabel(roleLabel: string): string {
  if (roleLabel === "Member") return "PRO MEMBER";
  return roleLabel.toUpperCase();
}

// Human: Shared row chrome for icon + label menu lines inside the profile popover.
// Agent: USED by profile/settings/logout/admin rows; destructive variant tints icon + label red.
function ProfileMenuRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
  highlighted,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={
        destructive
          ? (event) => {
              event.preventDefault();
              onClick?.();
            }
          : undefined
      }
      onClick={destructive ? undefined : onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] outline-none transition-colors",
        highlighted
          ? "bg-[#EFF6FF] font-semibold text-[#2563EB] hover:bg-[#EFF6FF]"
          : "text-[#1A1A1A] hover:bg-[#F7F8FA] focus:bg-[#F7F8FA]",
        destructive && "font-medium text-[#EF4444] hover:bg-[#F7F8FA] focus:bg-[#F7F8FA]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          destructive ? "text-[#EF4444]" : highlighted ? "text-[#2563EB]" : "text-[#666666]",
        )}
        aria-hidden
      />
      <span>{label}</span>
    </button>
  );
}

// Human: Section label for admin menu groupings (SYSTEM / PERSONAL) per Pencil Admin Profile Dropdown.
// Agent: RENDERS muted 10px caps label with section padding.
function ProfileMenuSectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-bold tracking-wide text-[#888888]">
      {children}
    </p>
  );
}

// Human: Popover panel anchored under the topbar profile trigger (desktop) or mobile avatar.
// Agent: READS isAdmin for layout width/sections; WRITES nothing; parent toggles open.
export function DriveProfileMenu({
  open,
  displayName,
  email,
  initials,
  roleLabel,
  isAdmin = false,
  onLogout,
  onAdminConsole,
  onProfile,
  className,
}: DriveProfileMenuProps) {
  if (!open) return null;

  return (
    <div
      role="menu"
      aria-label="Account menu"
      className={cn(
        "absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.1)]",
        isAdmin ? "w-[280px]" : "w-[244px]",
        className,
      )}
    >
      {/* Human: User header — larger avatar + name/email; standard adds PRO badge + active session */}
      <div className={cn("flex flex-col", isAdmin ? "px-3 pb-2 pt-3" : "gap-2 p-2.5")}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-[#2563EB] font-bold text-white",
              isAdmin ? "size-10 text-sm" : "size-9 text-[13px]",
            )}
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate text-sm font-bold text-[#1A1A1A]">{displayName}</p>
            {email ? (
              <p className="truncate text-[11px] text-[#666666]">{email}</p>
            ) : null}
            {isAdmin ? (
              <div className="mt-1 flex items-center">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-bold text-[#10B981]">
                  <Shield className="size-2.5 shrink-0" aria-hidden />
                  Admin
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {!isAdmin ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-md bg-[#DBEAFE] px-2 py-0.5 text-[9px] font-bold tracking-wide text-[#2563EB]">
              {profileBadgeLabel(roleLabel)}
            </span>
            <span className="text-[11px] font-medium text-[#10B981]">• Active</span>
          </div>
        ) : null}
      </div>

      <div className="h-px w-full bg-[#E5E7EB]" role="separator" />

      {isAdmin ? (
        <>
          <ProfileMenuSectionLabel>SYSTEM</ProfileMenuSectionLabel>
          <ProfileMenuRow
            icon={Shield}
            label="Admin Console"
            highlighted
            onClick={onAdminConsole}
            disabled={!onAdminConsole}
          />
          <ProfileMenuSectionLabel>PERSONAL</ProfileMenuSectionLabel>
        </>
      ) : null}

      <div className="flex flex-col gap-0.5 py-1">
        <ProfileMenuRow icon={User} label="My Profile" onClick={onProfile} disabled={!onProfile} />
        <ProfileMenuRow icon={Settings} label="Settings" disabled />
      </div>

      <div className="h-px w-full bg-[#E5E7EB]" role="separator" />

      <div className="py-1">
        <ProfileMenuRow icon={LogOut} label="Log Out" destructive onClick={onLogout} />
      </div>
    </div>
  );
}
