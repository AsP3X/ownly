// Human: Display helpers for Shared Files tables — avatars, dates, and row icon colors from Pencil.
// Agent: READS email/mime strings; RETURNS Tailwind class fragments and formatted labels.

import { displayNameFromEmail } from "@/lib/public-share-format";

const AVATAR_PALETTES = [
  { bg: "bg-[#DBEAFE]", text: "text-[#1E40AF]" },
  { bg: "bg-[#D1FAE5]", text: "text-[#065F46]" },
  { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]" },
  { bg: "bg-[#FEF3C7]", text: "text-[#92400E]" },
  { bg: "bg-[#F3E8FF]", text: "text-[#6B21A8]" },
] as const;

const STACK_AVATAR_COLORS = [
  "bg-[#3B82F6]",
  "bg-[#10B981]",
  "bg-[#F59E0B]",
  "bg-[#8B5CF6]",
  "bg-[#EF4444]",
] as const;

// Human: Stable avatar palette from email — matches Pencil shared-by / shared-with rows.
// Agent: HASHES email char codes; RETURNS bg + text Tailwind classes.
export function avatarPaletteForEmail(email: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) {
    hash = (hash + email.charCodeAt(i) * (i + 1)) % AVATAR_PALETTES.length;
  }
  return AVATAR_PALETTES[hash] ?? AVATAR_PALETTES[0]!;
}

// Human: Solid fill for stacked collaborator avatars on Shared by me rows.
// Agent: INDEXES into fixed palette for up to five visible initials.
export function stackAvatarColor(index: number): string {
  return STACK_AVATAR_COLORS[index % STACK_AVATAR_COLORS.length] ?? STACK_AVATAR_COLORS[0]!;
}

// Human: Calendar date for Shared with me — e.g. May 24, 2026.
// Agent: READS ISO string; RETURNS en-US long month label.
export function formatSharedCalendarDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Human: Relative label for Shared by me date column — e.g. 2 days ago, 1 week ago.
// Agent: COMPUTES day/week buckets from ISO timestamp.
export function formatSharedRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week ago";
  if (weeks < 5) return `${weeks} weeks ago`;
  return formatSharedCalendarDate(iso);
}

// Human: Lucide icon color for Shared with me name column — direct icon tint per Pencil rows.
// Agent: READS mime + folder flag; RETURNS hex color string.
export function sharedWithMeIconColor(mimeType: string | null, isFolder: boolean): string {
  if (isFolder) return "#3B82F6";
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) return "#10B981";
  if (mime.includes("pdf") || mime.startsWith("text/")) return "#EF4444";
  if (mime.startsWith("video/") || mime.startsWith("image/")) return "#2563EB";
  return "#2563EB";
}

// Human: Folder icon tint varies per row in Pencil — alternate amber for some folders.
// Agent: HASHES name when multiple folders need distinct colors.
export function sharedFolderIconColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash + name.charCodeAt(i)) % 2;
  }
  return hash === 0 ? "#3B82F6" : "#F59E0B";
}

// Human: Re-export display name helper for owner/grantee columns.
// Agent: CALLS displayNameFromEmail from public-share-format.
export function sharedPersonName(email: string): string {
  return displayNameFromEmail(email);
}
