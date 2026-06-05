// Human: Client-side draft storage for profile detail fields not yet persisted by the API.
// Agent: READS/WRITES localStorage keyed by user id; USED by ProfilePage save flow.

export type ProfileDetailsDraft = {
  fullName: string;
  jobTitle: string;
  department: string;
  bio: string;
};

const DETAILS_KEY_PREFIX = "ownly-profile-details-";
const PASSWORD_CHANGED_KEY_PREFIX = "ownly-password-changed-at-";
const PREFERENCES_KEY_PREFIX = "ownly-profile-preferences-";
const MFA_KEY_PREFIX = "ownly-profile-mfa-enabled-";

export type ProfilePreferences = {
  emailNotifications: boolean;
  securityAlerts: boolean;
};

export type ProfileSecurityDraft = {
  currentPassword: string;
  newPassword: string;
  mfaEnabled: boolean;
};

function detailsKey(userId: string) {
  return `${DETAILS_KEY_PREFIX}${userId}`;
}

function passwordChangedKey(userId: string) {
  return `${PASSWORD_CHANGED_KEY_PREFIX}${userId}`;
}

// Human: Load saved profile detail draft for the signed-in user.
// Agent: READS localStorage; RETURNS null when missing or parse fails.
export function readProfileDetailsDraft(userId: string): ProfileDetailsDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(detailsKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProfileDetailsDraft;
  } catch {
    return null;
  }
}

// Human: Persist profile detail draft after Save All Changes.
// Agent: WRITES JSON to localStorage for the user id.
export function writeProfileDetailsDraft(userId: string, draft: ProfileDetailsDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(detailsKey(userId), JSON.stringify(draft));
}

// Human: Read last password change timestamp for the summary card.
// Agent: READS localStorage; RETURNS ISO string or null.
export function readPasswordChangedAt(userId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(passwordChangedKey(userId));
}

// Human: Record password rotation time for the summary stat row.
// Agent: WRITES ISO timestamp to localStorage after successful PATCH /me/password.
export function writePasswordChangedAt(userId: string, iso: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(passwordChangedKey(userId), iso);
}

function mfaKey(userId: string) {
  return `${MFA_KEY_PREFIX}${userId}`;
}

// Human: Load MFA toggle state saved from the Security card.
// Agent: READS localStorage; RETURNS true when unset to mirror Pencil default-on toggle.
export function readProfileMfaEnabled(userId: string): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(mfaKey(userId));
  if (raw === null) return true;
  return raw === "true";
}

export function writeProfileMfaEnabled(userId: string, enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(mfaKey(userId), enabled ? "true" : "false");
}

function preferencesKey(userId: string) {
  return `${PREFERENCES_KEY_PREFIX}${userId}`;
}

// Human: Load notification preference toggles saved from the profile page.
// Agent: READS localStorage; RETURNS defaults when unset.
export function readProfilePreferences(userId: string): ProfilePreferences {
  if (typeof window === "undefined") {
    return { emailNotifications: true, securityAlerts: true };
  }
  const raw = window.localStorage.getItem(preferencesKey(userId));
  if (!raw) return { emailNotifications: true, securityAlerts: true };
  try {
    return JSON.parse(raw) as ProfilePreferences;
  } catch {
    return { emailNotifications: true, securityAlerts: true };
  }
}

export function writeProfilePreferences(userId: string, preferences: ProfilePreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
}
