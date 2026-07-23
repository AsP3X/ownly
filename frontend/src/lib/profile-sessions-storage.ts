// Human: UA helpers for optional client-side labels — session lists now come from /me/sessions.
// Agent: PURE navigator helpers; DEMO localStorage seed removed.

export type ProfileSessionDeviceType = "laptop" | "smartphone" | "monitor";

// Human: Guess a friendly device label from the browser user agent string.
// Agent: READS navigator.userAgent; RETURNS Pencil-style device name for display polish.
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
