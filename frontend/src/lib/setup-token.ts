// Human: In-memory bootstrap secret for first-run setup mutations — never baked into production bundles.
// Agent: SET by SetupPage before POST /setup*; READ by setupMutationHeaders; CLEARED after setup completes.

let setupToken: string | null = null;

// Human: Remember the operator-supplied setup token for the current browser session only.
// Agent: WRITES module state; NOT persisted to web storage.
export function setSetupToken(token: string) {
  const trimmed = token.trim();
  setupToken = trimmed || null;
}

// Human: Read the active setup token for X-Setup-Token headers.
// Agent: RETURNS null when unset — setup mutations fail until the operator provides the secret.
export function getSetupToken(): string | null {
  return setupToken;
}

// Human: Drop the bootstrap secret after successful setup or when leaving the wizard.
// Agent: CLEARS in-memory token so later tabs cannot reuse it accidentally.
export function clearSetupToken() {
  setupToken = null;
}
