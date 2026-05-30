// Human: Format public-share sidebar dates from ISO timestamps returned by the overview API.
// Agent: READS created_at / expires_at strings; RETURNS display labels for the SHARED BY card.

// Human: Format an ISO timestamp as a short calendar date for the sidebar.
// Agent: USES locale date string; RETURNS em dash when input is empty.
export function formatShareDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Human: Human-readable expiry label — "In N days" or "Expired" for the sidebar.
// Agent: COMPARES expires_at to now; RETURNS secondary line with absolute date when useful.
export function formatShareExpiry(iso: string | null | undefined): string {
  if (!iso) return "No expiration";
  const expires = new Date(iso);
  if (Number.isNaN(expires.getTime())) return "—";
  const now = Date.now();
  const diffMs = expires.getTime() - now;
  const absolute = formatShareDate(iso);
  if (diffMs <= 0) return `Expired (${absolute})`;
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days === 1) return `In 1 day (${absolute})`;
  return `In ${days} days (${absolute})`;
}

// Human: Derive display name from sharer email for avatar initials and headline.
// Agent: SPLITS local-part; TITLE-CASES on dots; FALLBACK to full email.
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
