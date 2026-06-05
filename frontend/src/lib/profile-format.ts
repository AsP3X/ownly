// Human: Display formatters for profile summary rows and metadata lines.
// Agent: READS ISO timestamps; RETURNS Pencil-style joined/relative labels.

// Human: Format member-since line like Pencil "Joined March 2024".
// Agent: READS ISO created_at; RETURNS localized month + year label.
export function formatProfileJoinedDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `Joined ${date.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;
}

// Human: Relative days label for password reset stat — mirrors Pencil "14 days ago".
// Agent: READS ISO timestamp; RETURNS relative phrase or em dash.
export function formatProfileDaysAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Human: Location line under profile name — city + short timezone per Pencil summary card.
// Agent: READS Intl timezone; RETURNS display string for summary card.
export function formatProfileLocationLabel(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  const shortTz =
    new Date()
      .toLocaleTimeString(undefined, { timeZone, timeZoneName: "short" })
      .split(" ")
      .pop() ?? "";
  return shortTz ? `${city} (${shortTz})` : city;
}

// Human: Session metadata city line — Pencil "San Francisco, USA" without timezone suffix.
// Agent: READS Intl timezone; RETURNS city + country placeholder for authorized session rows.
export function formatProfileSessionLocationLabel(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  return `${city}, USA`;
}
