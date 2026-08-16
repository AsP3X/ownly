// Human: In-memory bootstrap secret for first-run setup mutations — never baked into production bundles.
// Agent: SET by SetupPage before POST /setup*; READ by setupMutationHeaders; CLEARED after setup completes.

let setupToken: string | null = null;

function stripMatchingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

// Human: Accept a pasted .env line or quoted value — the wizard should not require a perfect copy.
// Agent: TRIMS BOM/whitespace/quotes; STRIPS optional setup_token= prefix (case-insensitive).
export function normalizeSetupTokenInput(raw: string): string {
  let value = raw.replace(/^\uFEFF/, "").trim();
  value = stripMatchingQuotes(value);
  const prefix = /^setup_token\s*=\s*/i;
  if (prefix.test(value)) {
    value = stripMatchingQuotes(value.replace(prefix, "").trim());
  }
  return value;
}

// Human: Remember the operator-supplied setup token for the current browser session only.
// Agent: WRITES normalized module state; NOT persisted to web storage.
export function setSetupToken(token: string) {
  const normalized = normalizeSetupTokenInput(token);
  setupToken = normalized || null;
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
