// Human: In-memory storage for visitor passwords on protected public share links.
// Agent: KEEPS passwords in a module Map for the SPA lifetime; USED by PublicSharePage + preview dialogs.

const sharePasswords = new Map<string, string>();

// Human: Load a previously verified share password for this browser session.
// Agent: READS in-memory map; RETURNS null when absent.
export function getStoredSharePassword(token: string): string | null {
  if (!token) return null;
  return sharePasswords.get(token) ?? null;
}

// Human: Remember a verified share password until the SPA reloads.
// Agent: WRITES module map; CALLED after successful protected share fetch.
export function setStoredSharePassword(token: string, password: string) {
  if (!token || !password) return;
  sharePasswords.set(token, password);
}

// Human: Drop a cached share password after revoke or failed verification.
// Agent: REMOVES in-memory entry for token.
export function clearStoredSharePassword(token: string) {
  if (!token) return;
  sharePasswords.delete(token);
}

// Human: Build hls.js xhrSetup hook that attaches the visitor password header.
// Agent: SETS X-Share-Password on playlist/segment/key requests for protected shares.
export function createSharePasswordXhrSetup(sharePassword?: string | null) {
  if (!sharePassword) return undefined;
  return (xhr: XMLHttpRequest) => {
    xhr.setRequestHeader("X-Share-Password", sharePassword);
  };
}
