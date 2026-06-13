// Human: Decode JWT payload claims without verifying signature — used only for client-side expiry scheduling.
// Agent: READS base64url middle segment; RETURNS exp/iat when present; NEVER used for authorization decisions.

type JwtPayload = {
  exp?: number;
  iat?: number;
};

function decodeBase64Url(segment: string): string | null {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    return atob(normalized + padding);
  } catch {
    return null;
  }
}

// Human: Read `exp` from a stored access token so AuthProvider can refresh before the 24h window closes.
// Agent: PARSES JWT middle segment JSON; RETURNS unix seconds or null when malformed.
export function getJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const json = decodeBase64Url(parts[1]);
  if (!json) return null;
  try {
    const payload = JSON.parse(json) as JwtPayload;
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}
