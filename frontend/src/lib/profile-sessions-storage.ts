// Human: Client-side authorized session rows for the profile settings page.
// Agent: READS/WRITES localStorage per user; SUPPLEMENTS live current-device row until /me/sessions exists.

export type ProfileSessionDeviceType = "laptop" | "smartphone" | "monitor";

export type ProfileSessionRow = {
  id: string;
  deviceName: string;
  deviceType: ProfileSessionDeviceType;
  location: string;
  ip: string;
  client: string;
  lastActiveLabel?: string;
};

const SESSIONS_KEY_PREFIX = "ownly-profile-sessions-";

function sessionsKey(userId: string) {
  return `${SESSIONS_KEY_PREFIX}${userId}`;
}

const DEFAULT_REMOTE_SESSIONS: ProfileSessionRow[] = [
  {
    id: "demo-iphone",
    deviceName: "iPhone 15 Pro",
    deviceType: "smartphone",
    location: "San Francisco, USA",
    ip: "172.56.21.90",
    client: "Ownly Mobile App",
    lastActiveLabel: "2 hours ago",
  },
  {
    id: "demo-windows",
    deviceName: "Windows Desktop",
    deviceType: "monitor",
    location: "New York, USA",
    ip: "64.233.160.10",
    client: "Edge Browser",
    lastActiveLabel: "3 days ago",
  },
];

// Human: Seed remote session cards shown in the Pencil Authorized Sessions card.
// Agent: READS localStorage; RETURNS defaults when unset.
export function readProfileRemoteSessions(userId: string): ProfileSessionRow[] {
  if (typeof window === "undefined") return DEFAULT_REMOTE_SESSIONS;
  const raw = window.localStorage.getItem(sessionsKey(userId));
  if (!raw) return DEFAULT_REMOTE_SESSIONS;
  try {
    const parsed = JSON.parse(raw) as ProfileSessionRow[];
    return Array.isArray(parsed) ? parsed : DEFAULT_REMOTE_SESSIONS;
  } catch {
    return DEFAULT_REMOTE_SESSIONS;
  }
}

// Human: Persist session list after a revoke action removes a row.
// Agent: WRITES JSON array to localStorage for the user id.
export function writeProfileRemoteSessions(userId: string, sessions: ProfileSessionRow[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(sessionsKey(userId), JSON.stringify(sessions));
}

// Human: Guess a friendly device label from the browser user agent string.
// Agent: READS navigator.userAgent; RETURNS Pencil-style device name for the current session row.
export function detectCurrentSessionDeviceName(): string {
  if (typeof navigator === "undefined") return "This Device";
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android Device";
  if (/Macintosh|Mac OS X/i.test(ua)) return 'MacBook Pro 16"';
  if (/Windows/i.test(ua)) return "Windows Desktop";
  if (/Linux/i.test(ua)) return "Linux Desktop";
  return "This Device";
}

// Human: Map user agent to the Pencil session icon bucket.
// Agent: READS navigator.userAgent; RETURNS laptop | smartphone | monitor.
export function detectCurrentSessionDeviceType(): ProfileSessionDeviceType {
  if (typeof navigator === "undefined") return "laptop";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|Android|Mobile/i.test(ua)) return "smartphone";
  if (/Windows|Linux/i.test(ua)) return "monitor";
  return "laptop";
}

// Human: Best-effort browser label for the current session metadata line.
// Agent: READS navigator.userAgent; RETURNS Chrome/Safari/Firefox/Edge style label.
export function detectCurrentSessionBrowserLabel(): string {
  if (typeof navigator === "undefined") return "Browser";
  const ua = navigator.userAgent;
  if (/Edg\//i.test(ua)) return "Edge Browser";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome Browser";
  if (/Firefox\//i.test(ua)) return "Firefox Browser";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari Browser";
  return "Browser";
}
