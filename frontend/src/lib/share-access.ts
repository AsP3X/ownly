// Human: Session-scoped storage for visitor passwords on protected public share links.
// Agent: READS/WRITES sessionStorage keyed by share token; USED by PublicSharePage + preview dialogs.

const SHARE_PASSWORD_PREFIX = "ownly.share.password.";

// Human: Load a previously verified share password for this browser tab session.
// Agent: READS sessionStorage; RETURNS null when absent.
export function getStoredSharePassword(token: string): string | null {
  if (!token) return null;
  return sessionStorage.getItem(`${SHARE_PASSWORD_PREFIX}${token}`);
}

// Human: Remember a verified share password until the tab session ends.
// Agent: WRITES sessionStorage; CALLED after successful protected share fetch.
export function setStoredSharePassword(token: string, password: string) {
  if (!token || !password) return;
  sessionStorage.setItem(`${SHARE_PASSWORD_PREFIX}${token}`, password);
}

// Human: Drop a cached share password after revoke or failed verification.
// Agent: REMOVES sessionStorage entry for token.
export function clearStoredSharePassword(token: string) {
  if (!token) return;
  sessionStorage.removeItem(`${SHARE_PASSWORD_PREFIX}${token}`);
}

// Human: Build hls.js xhrSetup hook that attaches the visitor password header.
// Agent: SETS X-Share-Password on playlist/segment/key requests for protected shares.
export function createSharePasswordXhrSetup(sharePassword?: string | null) {
  if (!sharePassword) return undefined;
  return (xhr: XMLHttpRequest) => {
    xhr.setRequestHeader("X-Share-Password", sharePassword);
  };
}
